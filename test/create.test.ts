import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { type CreateOptions, createProject } from "../src/create";
import { setupLogin } from "../src/login";
import { UserError } from "../src/system";
import { updateProject } from "../src/update";
import {
	fakeDocker,
	git,
	makeLoginRepo,
	makeTemplate,
	recordingIo,
	tempDir,
	write,
} from "./helpers";

const saved = { ...process.env };

beforeAll(() => {
	// Keep the machine's Git identity and config out of the tests.
	process.env.HOME = tempDir("home-");
	process.env.GIT_CONFIG_GLOBAL = "/dev/null";
	process.env.GIT_CONFIG_NOSYSTEM = "1";
});

afterAll(() => {
	for (const key of Object.keys(process.env)) delete process.env[key];
	Object.assign(process.env, saved);
});

function options(dir: string, extra: Partial<CreateOptions> = {}): CreateOptions {
	return {
		dir,
		fork: false,
		buildLogin: false,
		install: false,
		yes: true,
		...extra,
	};
}

describe("createProject", () => {
	test("copies the latest release, renames it, and starts a fresh history", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "acme-platform");
		const io = recordingIo();
		await createProject(options(target, { templateUrl: template.url }), io);

		// v0.10.0 is the latest release (not v0.2.0, and not the beta).
		expect(existsSync(join(target, "CHANGELOG.md"))).toBe(true);
		const config = JSON.parse(readFileSync(join(target, ".vern/config.json"), "utf8"));
		expect(config.project).toEqual({ name: "Acme Platform", slug: "acme-platform" });
		expect(config.upstream.lastSyncedSha).toBe(git(template.dir, "rev-parse", "v0.10.0^{commit}"));
		expect(config.upstream.apply).toBe(true);
		expect(readFileSync(join(target, "README.md"), "utf8")).toBe("# Acme Platform\n");

		// Its own history: one commit, already renamed. Neither the template's commits
		// nor the staging commit made for the rename are carried over.
		const subjects = git(target, "log", "--format=%s").split("\n");
		expect(subjects).toHaveLength(1);
		expect(subjects[0]).toStartWith("chore: initial commit from Vern ");
		expect(git(target, "show", "--stat", "--format=", "HEAD")).toContain(".vern/config.json");
		expect(git(target, "status", "--porcelain")).toBe("");
		expect(git(target, "remote")).toBe("");
		expect(git(target, "branch", "--show-current")).toBe("main");
		// Git had no identity configured in this test.
		expect(git(target, "log", "-1", "--format=%an")).toBe("create-vern");
		expect(io.lines.join("\n")).toContain("moon generate tanstack");
	});

	test("takes a name and a slug that differ from the folder", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "folder");
		await createProject(
			options(target, { templateUrl: template.url, name: "Acme Co.", slug: "acme", ref: "v0.2.0" }),
			recordingIo(),
		);
		const config = JSON.parse(readFileSync(join(target, ".vern/config.json"), "utf8"));
		expect(config.project).toEqual({ name: "Acme Co.", slug: "acme" });
		expect(config.upstream.lastSyncedSha).toBe(template.sha);
		expect(existsSync(join(target, "CHANGELOG.md"))).toBe(false);
	});

	test("accepts a commit as the ref", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "by-sha");
		await createProject(options(target, { templateUrl: template.url, ref: template.sha }), recordingIo());
		const config = JSON.parse(readFileSync(join(target, ".vern/config.json"), "utf8"));
		expect(config.upstream.lastSyncedSha).toBe(template.sha);
	});

	test("refuses a folder that is not empty, before downloading anything", async () => {
		const target = tempDir();
		write(target, "keep.txt", "mine");
		await expect(
			createProject(options(target, { templateUrl: "file:///does/not/exist" }), recordingIo()),
		).rejects.toThrow(/not empty/);
	});

	test("refuses a name the template would reject", async () => {
		await expect(
			createProject(
				options(join(tempDir(), "x"), { templateUrl: "file:///does/not/exist", name: "Bad!", slug: "bad" }),
				recordingIo(),
			),
		).rejects.toThrow(UserError);
	});

	test("needs a directory when it cannot ask", async () => {
		await expect(createProject(options(""), recordingIo())).rejects.toThrow(/Provide a project directory/);
	});

	test("asks for the name, the slug, and the login when run in a terminal", async () => {
		const template = makeTemplate();
		const login = makeLoginRepo();
		const target = join(tempDir(), "asked");
		const asked: string[] = [];
		const io = recordingIo({
			interactive: true,
			ask: async (question, fallback) => {
				asked.push(question);
				return question === "Project name" ? "Asked Co" : fallback;
			},
			confirm: async (question) => {
				asked.push(question);
				return false;
			},
		});
		await createProject(
			{ ...options(target, { templateUrl: template.url, loginUrl: login.url }), yes: false },
			io,
		);
		expect(asked[0]).toBe("Project name");
		expect(asked[1]).toBe("Package slug");
		expect(asked[2]).toStartWith("Customize the login page layout?");
		const config = JSON.parse(readFileSync(join(target, ".vern/config.json"), "utf8"));
		expect(config.project).toEqual({ name: "Asked Co", slug: "asked-co" });
		expect(existsSync(join(target, "..", "asked-co-login"))).toBe(false);
	});

	test("stops with a clear message when the rename fails", async () => {
		const template = makeTemplate();
		write(template.dir, "scripts/rename-project.ts", "process.exit(3);\n");
		git(template.dir, "add", "-A");
		git(template.dir, "-c", "user.name=F", "-c", "user.email=f@example.com", "commit", "--quiet", "-m", "broken");
		git(template.dir, "tag", "v1.0.0");
		const target = join(tempDir(), "broken");
		const parent = dirname(target);
		await expect(
			createProject(options(target, { templateUrl: template.url }), recordingIo()),
		).rejects.toThrow(/rename failed/);
		// Nothing is left behind: no half-made project and no staging folder.
		expect(existsSync(target)).toBe(false);
		expect(readdirSync(parent)).toEqual([]);
	});

	test("leaves no staging folder next to a project that was created", async () => {
		const template = makeTemplate();
		const parent = tempDir();
		await createProject(options(join(parent, "acme"), { templateUrl: template.url }), recordingIo());
		expect(readdirSync(parent)).toEqual(["acme"]);
	});

	test("creates missing parent folders and fills an empty target folder", async () => {
		const template = makeTemplate();
		const nested = join(tempDir(), "deep", "er", "acme");
		await createProject(options(nested, { templateUrl: template.url }), recordingIo());
		expect(existsSync(join(nested, ".vern/config.json"))).toBe(true);

		const empty = join(tempDir(), "empty");
		mkdirSync(empty);
		await createProject(options(empty, { templateUrl: template.url }), recordingIo());
		expect(existsSync(join(empty, ".vern/config.json"))).toBe(true);
	});

	test("does not need Docker to create a project", async () => {
		const template = makeTemplate();
		// A Docker that is not running would fail every call; none must be made.
		const docker = fakeDocker(1);
		process.env.PATH = `${docker.bin}${delimiter}${saved.PATH ?? ""}`;
		try {
			await createProject(options(join(tempDir(), "acme"), { templateUrl: template.url }), recordingIo());
			expect(existsSync(docker.log)).toBe(false);
		} finally {
			process.env.PATH = saved.PATH;
		}
	});
});

describe("createProject with the login", () => {
	test("clones the login next to the project and builds its image", async () => {
		const template = makeTemplate();
		const login = makeLoginRepo();
		const docker = fakeDocker();
		process.env.PATH = `${docker.bin}${delimiter}${saved.PATH ?? ""}`;
		try {
			const parent = tempDir();
			const target = join(parent, "acme");
			const io = recordingIo();
			await createProject(
				options(target, { templateUrl: template.url, loginUrl: login.url, login: true, buildLogin: true }),
				io,
			);
			expect(existsSync(join(parent, "acme-login", ".vern/login.Dockerfile"))).toBe(true);
			const built = readFileSync(docker.log, "utf8");
			expect(built).toContain("build -f .vern/login.Dockerfile -t acme-login:local .");
			const env = readFileSync(join(target, "apps/auth-server/.env"), "utf8");
			expect(env).toBe("ZITADEL_VERSION=v9.9.9\nZITADEL_LOGIN_IMAGE=acme-login:local\n");
			// .env is not tracked, so the project's history stays clean.
			expect(git(target, "status", "--porcelain")).toBe("");
		} finally {
			process.env.PATH = saved.PATH;
		}
	});

	test("keeps the published image when the build fails", async () => {
		const login = makeLoginRepo();
		const docker = fakeDocker(1);
		process.env.PATH = `${docker.bin}${delimiter}${saved.PATH ?? ""}`;
		try {
			const project = tempDir();
			write(project, "apps/auth-server/.env.example", "ZITADEL_LOGIN_IMAGE=published\n");
			const io = recordingIo();
			setupLogin(project, "acme", { fork: false, build: true, dir: join(tempDir(), "l"), url: login.url }, io);
			expect(existsSync(join(project, "apps/auth-server/.env"))).toBe(false);
			expect(io.warnings.join("\n")).toContain("build failed");
		} finally {
			process.env.PATH = saved.PATH;
		}
	});

	test("reuses a login checkout that is already there", () => {
		const login = makeLoginRepo();
		const dir = join(tempDir(), "existing");
		const io = recordingIo();
		setupLogin(tempDir(), "acme", { fork: false, build: false, dir, url: login.url }, io);
		setupLogin(tempDir(), "acme", { fork: false, build: false, dir, url: login.url }, io);
		expect(io.lines.join("\n")).toContain("Using the existing");
	});

	test("refuses to overwrite a folder that is not a login checkout", () => {
		const dir = tempDir();
		write(dir, "notes.txt", "mine");
		expect(() =>
			setupLogin(tempDir(), "acme", { fork: false, build: false, dir, url: "file:///nope" }, recordingIo()),
		).toThrow(/not a vern-zitadel-login checkout/);
	});
});

describe("updateProject", () => {
	test("runs the project's own update script from the project root", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "upd");
		await createProject(options(target, { templateUrl: template.url }), recordingIo());
		// A nested folder resolves to the project root, and the flags are passed through.
		const status = updateProject(["--apply"], join(target, "scripts"));
		expect(status).toBe(0);
		expect(readFileSync(join(target, "update-ran.txt"), "utf8")).toBe("--apply");
	});

	test("says so when run outside a project", () => {
		expect(() => updateProject([], tempDir())).toThrow(/No .*config.json found/);
	});
});
