import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createProject } from "../../src/create/create-project";
import { UserError } from "../../src/system/errors";
import {
	addCliRelease,
	createOptions,
	fakeDocker,
	git,
	isolateGit,
	makeLoginRepo,
	makeTemplate,
	readConfig,
	recordingIo,
	tempDir,
	withPath,
	write,
} from "../helpers";

isolateGit();

describe("createProject", () => {
	test("copies the latest release, renames it, and starts a fresh history", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "acme-platform");
		const io = recordingIo();
		await createProject(createOptions(target, { templateUrl: template.url }), io);

		// v0.10.0 is the latest release (not v0.2.0, and not the beta).
		expect(existsSync(join(target, "CHANGELOG.md"))).toBe(true);
		const config = readConfig(target);
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
		// Git had no identity configured in this test, which is said once.
		expect(git(target, "log", "-1", "--format=%an")).toBe("create-vern");
		expect(io.warnings).toEqual(["Git has no user.name/user.email; committing as create-vern."]);
		expect(io.lines.join("\n")).toContain("moon generate tanstack");
	});

	test("takes a name and a slug that differ from the folder", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "folder");
		await createProject(
			createOptions(target, { templateUrl: template.url, name: "Acme Co.", slug: "acme", ref: "v0.2.0" }),
			recordingIo(),
		);
		const config = readConfig(target);
		expect(config.project).toEqual({ name: "Acme Co.", slug: "acme" });
		expect(config.upstream.lastSyncedSha).toBe(template.sha);
		expect(existsSync(join(target, "CHANGELOG.md"))).toBe(false);
	});

	test("accepts a commit as the ref", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "by-sha");
		await createProject(createOptions(target, { templateUrl: template.url, ref: template.sha }), recordingIo());
		expect(readConfig(target).upstream.lastSyncedSha).toBe(template.sha);
	});

	test("refuses a folder that is not empty, before downloading anything", async () => {
		const target = tempDir();
		write(target, "keep.txt", "mine");
		await expect(
			createProject(createOptions(target, { templateUrl: "file:///does/not/exist" }), recordingIo()),
		).rejects.toThrow(/not empty/);
	});

	test("refuses a name the template would reject", async () => {
		await expect(
			createProject(
				createOptions(join(tempDir(), "x"), { templateUrl: "file:///does/not/exist", name: "Bad!", slug: "bad" }),
				recordingIo(),
			),
		).rejects.toThrow(UserError);
	});

	test("needs a directory when it cannot ask", async () => {
		await expect(createProject(createOptions(""), recordingIo())).rejects.toThrow(/Provide a project directory/);
	});

	test("resolves a relative directory against the given working directory", async () => {
		const template = makeTemplate();
		const cwd = tempDir();
		const io = recordingIo();
		await createProject(createOptions("acme", { cwd, templateUrl: template.url }), io);
		expect(existsSync(join(cwd, "acme", ".vern/config.json"))).toBe(true);
		expect(io.lines.join("\n")).toContain("Created Acme in acme. Next:");
	});

	test("asks for the name, the slug, the environments, and the login when run in a terminal", async () => {
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
			createOptions(target, { templateUrl: template.url, loginUrl: login.url, yes: false }),
			io,
		);
		expect(asked[0]).toBe("Project name");
		expect(asked[1]).toBe("Package slug");
		expect(asked.slice(2, 5).map((question) => question.split("?")[0])).toEqual([
			"How does production run",
			"How does staging run",
			"How does a rehearsal of production on your machine run",
		]);
		expect(asked[5]).toStartWith("Customize the login page layout?");
		expect(readConfig(target).project).toEqual({ name: "Asked Co", slug: "asked-co" });
		// Enter takes the defaults: one server with Docker for production, and nothing else.
		expect(readConfig(target).environments).toEqual({ local: "none", staging: "none", prod: "compose" });
		expect(existsSync(join(target, "..", "asked-co-login"))).toBe(false);
	});

	test("asks nothing with --yes, even in a terminal", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "quiet");
		const asked: string[] = [];
		const io = recordingIo({
			interactive: true,
			ask: async (question, fallback) => {
				asked.push(question);
				return fallback;
			},
			confirm: async (question, fallback) => {
				asked.push(question);
				return fallback;
			},
		});
		await createProject(createOptions(target, { templateUrl: template.url }), io);
		expect(asked).toEqual([]);
		expect(readConfig(target).project).toEqual({ name: "Quiet", slug: "quiet" });
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
			createProject(createOptions(target, { templateUrl: template.url }), recordingIo()),
		).rejects.toThrow(/rename failed/);
		// Nothing is left behind: no half-made project and no staging folder.
		expect(existsSync(target)).toBe(false);
		expect(readdirSync(parent)).toEqual([]);
	});

	test("leaves no staging folder next to a project that was created", async () => {
		const template = makeTemplate();
		const parent = tempDir();
		await createProject(createOptions(join(parent, "acme"), { templateUrl: template.url }), recordingIo());
		expect(readdirSync(parent)).toEqual(["acme"]);
	});

	test("creates missing parent folders and fills an empty target folder", async () => {
		const template = makeTemplate();
		const nested = join(tempDir(), "deep", "er", "acme");
		await createProject(createOptions(nested, { templateUrl: template.url }), recordingIo());
		expect(existsSync(join(nested, ".vern/config.json"))).toBe(true);

		const empty = join(tempDir(), "empty");
		mkdirSync(empty);
		await createProject(createOptions(empty, { templateUrl: template.url }), recordingIo());
		expect(existsSync(join(empty, ".vern/config.json"))).toBe(true);
	});

	test("does not need Docker to create a project", async () => {
		const template = makeTemplate();
		// A Docker that is not running would fail every call; none must be made.
		const docker = fakeDocker(1);
		await withPath(docker.bin, async () => {
			await createProject(createOptions(join(tempDir(), "acme"), { templateUrl: template.url }), recordingIo());
			expect(existsSync(docker.log)).toBe(false);
		});
	});
});

describe("createProject from a release with its commands in packages/cli", () => {
	test("renames with the template's own CLI, which leaves the project", async () => {
		const template = makeTemplate();
		const sha = addCliRelease(template);
		const target = join(tempDir(), "acme");
		await createProject(createOptions(target, { templateUrl: template.url }), recordingIo());
		const config = readConfig(target);
		expect(config.project).toEqual({ name: "Acme", slug: "acme" });
		expect(config.upstream).toEqual({ lastSyncedSha: sha, apply: true });
		// It ran on the throwaway repository, from a copy outside the project.
		expect(config.rename).toEqual({ ranInside: false, hadGit: true });
		expect(existsSync(join(target, "packages/cli"))).toBe(false);
		expect(existsSync(join(target, "scripts"))).toBe(false);
		expect(readFileSync(join(target, "README.md"), "utf8")).toBe("# Acme\n");
		expect(git(target, "rev-list", "--count", "HEAD")).toBe("1");
		expect(git(target, "status", "--porcelain")).toBe("");
	});

	test("chooses the environments after the rename removed the source", async () => {
		const template = makeTemplate();
		addCliRelease(template);
		const target = join(tempDir(), "acme");
		await createProject(
			createOptions(target, {
				templateUrl: template.url,
				environments: { prod: "kubernetes", staging: "none", local: "none" },
			}),
			recordingIo(),
		);
		const config = readConfig(target);
		expect(config.environments).toEqual({ prod: "kubernetes", staging: "none", local: "none" });
		expect(config.stack).toEqual({ ranInside: false, hadGit: false });
		expect(existsSync(join(target, "deploy/compose"))).toBe(false);
		expect(existsSync(join(target, "deploy/base/kustomization.yaml"))).toBe(true);
		expect(git(target, "status", "--porcelain")).toBe("");
	});

	test("leaves no copy of the CLI behind, also when the rename fails", async () => {
		const template = makeTemplate();
		addCliRelease(template);
		write(template.dir, "packages/cli/src/bin.ts", "process.exit(3);\n");
		git(template.dir, "add", "-A");
		git(template.dir, "-c", "user.name=F", "-c", "user.email=f@example.com", "commit", "--quiet", "-m", "broken");
		git(template.dir, "tag", "v1.0.0");
		// A temporary folder of its own, to see what the installer leaves in it.
		const saved = process.env.TMPDIR;
		const scratch = tempDir("scratch-");
		process.env.TMPDIR = scratch;
		try {
			const target = join(tempDir(), "broken");
			await expect(
				createProject(createOptions(target, { templateUrl: template.url }), recordingIo()),
			).rejects.toThrow(/rename failed/);
			expect(existsSync(target)).toBe(false);
			await createProject(createOptions(target, { templateUrl: template.url, ref: "v0.12.0" }), recordingIo());
			expect(readdirSync(scratch).filter((name) => name.startsWith("create-vern-cli-"))).toEqual([]);
		} finally {
			if (saved === undefined) delete process.env.TMPDIR;
			else process.env.TMPDIR = saved;
		}
	});
});

describe("createProject with the login", () => {
	test("clones the login next to the project and builds its image", async () => {
		const template = makeTemplate();
		const login = makeLoginRepo();
		const docker = fakeDocker();
		await withPath(docker.bin, async () => {
			const parent = tempDir();
			const target = join(parent, "acme");
			await createProject(
				createOptions(target, { templateUrl: template.url, loginUrl: login.url, login: true, buildLogin: true }),
				recordingIo(),
			);
			expect(existsSync(join(parent, "acme-login", ".vern/login.Dockerfile"))).toBe(true);
			const built = readFileSync(docker.log, "utf8");
			expect(built).toContain("build -f .vern/login.Dockerfile -t acme-login:local .");
			const env = readFileSync(join(target, "deploy/dev/auth-server/.env"), "utf8");
			expect(env).toBe("ZITADEL_VERSION=v9.9.9\nZITADEL_LOGIN_IMAGE=acme-login:local\n");
			// .env is not tracked, so the project's history stays clean.
			expect(git(target, "status", "--porcelain")).toBe("");
		});
	});

	test("keeps both ways to run an environment when nothing is chosen", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "acme");
		await createProject(createOptions(target, { templateUrl: template.url }), recordingIo());
		expect(readConfig(target).environments).toBeUndefined();
		expect(existsSync(join(target, "deploy/compose/docker-compose.yml"))).toBe(true);
		expect(existsSync(join(target, "deploy/base/kustomization.yaml"))).toBe(true);
	});

	test("keeps only what the chosen environments use, in the first commit", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "acme");
		const io = recordingIo();
		await createProject(
			createOptions(target, { templateUrl: template.url, environments: { prod: "kubernetes", staging: "none", local: "kubernetes" } }),
			io,
		);
		const config = readConfig(target);
		expect(config.environments).toEqual({ local: "kubernetes", staging: "none", prod: "kubernetes" });
		// The template's script ran after the rename, on the copy without a repository.
		expect(config.project.slug).toBe("acme");
		expect(config.hadGit).toBe(false);
		expect(existsSync(join(target, "deploy/compose"))).toBe(false);
		expect(existsSync(join(target, "deploy/base/kustomization.yaml"))).toBe(true);
		expect(git(target, "log", "--format=%s").split("\n")).toHaveLength(1);
		expect(git(target, "status", "--porcelain")).toBe("");
		expect(git(target, "ls-files", "deploy")).not.toContain("deploy/compose");
		expect(io.lines.join("\n")).toContain("Keeping what the environments use (prod: kubernetes, staging: none, local: kubernetes)");
	});

	test("asks how each environment runs, production first", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "acme");
		const asked: string[] = [];
		const answers = ["", "", "everywhere", "kubernetes", "", "compose"];
		const io = recordingIo({
			interactive: true,
			ask: async (question, fallback) => {
				asked.push(question);
				return answers.shift() || fallback;
			},
		});
		await createProject(createOptions(target, { templateUrl: template.url, yes: false, login: false }), io);
		expect(asked.map((question) => question.split("?")[0])).toEqual([
			"Project name",
			"Package slug",
			// An answer that is not a choice is asked again.
			"How does production run",
			"How does production run",
			"How does staging run",
			"How does a rehearsal of production on your machine run",
		]);
		expect(readConfig(target).environments).toEqual({ local: "compose", staging: "none", prod: "kubernetes" });
	});

	test("puts the choice off when the answer is later", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "acme");
		const asked: string[] = [];
		const io = recordingIo({
			interactive: true,
			ask: async (question, fallback) => {
				asked.push(question);
				return question.startsWith("How does production") ? "later" : fallback;
			},
		});
		await createProject(createOptions(target, { templateUrl: template.url, yes: false, login: false }), io);
		expect(asked).toHaveLength(3);
		expect(readConfig(target).environments).toBeUndefined();
		expect(existsSync(join(target, "deploy/base/kustomization.yaml"))).toBe(true);
	});

	test("refuses a choice that is not one, or only part of one, before downloading anything", async () => {
		const options = (environments: Record<string, string>) =>
			createOptions(join(tempDir(), "acme"), { templateUrl: "file:///does/not/exist", environments });
		await expect(createProject(options({ prod: "none", staging: "none", local: "none" }), recordingIo())).rejects.toThrow(
			"--prod takes compose, or kubernetes.",
		);
		await expect(createProject(options({ prod: "compose" }), recordingIo())).rejects.toThrow(
			"Pass --prod, --staging, and --local together, or none of them to keep both ways.",
		);
	});

	test("creates nothing when the template cannot apply the choice", async () => {
		const template = makeTemplate();
		const parent = tempDir();
		const target = join(parent, "acme");
		// A script that fails, as Vern's does on a real error.
		const fixture = join(template.dir, "scripts/stack-project.ts");
		write(template.dir, "scripts/stack-project.ts", `process.exit(1);\n${readFileSync(fixture, "utf8")}`);
		git(template.dir, "add", "-A");
		git(template.dir, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "--quiet", "-m", "broken");
		await expect(
			createProject(
				createOptions(target, { templateUrl: template.url, ref: "main", environments: { prod: "compose", staging: "none", local: "none" } }),
				recordingIo(),
			),
		).rejects.toThrow("Choosing the environments failed, so no project was created.");
		expect(readdirSync(parent)).toEqual([]);
	});

	test("says so when the release of Vern is from before it could choose", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "acme");
		const io = recordingIo();
		await createProject(
			createOptions(target, { templateUrl: template.url, ref: "v0.2.0", environments: { prod: "compose", staging: "none", local: "none" } }),
			io,
		);
		expect(io.warnings.join("\n")).toContain("cannot choose how the environments run yet");
		expect(readConfig(target).environments).toBeUndefined();
	});

	test("finishes the project when the login cannot be set up", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "acme");
		const io = recordingIo();
		await createProject(
			createOptions(target, { templateUrl: template.url, loginUrl: "file:///does/not/exist", login: true }),
			io,
		);
		expect(existsSync(join(target, ".vern/config.json"))).toBe(true);
		expect(io.warnings.join("\n")).toContain("Login setup stopped:");
		expect(io.lines.join("\n")).toContain("Created Acme in");
	});
});
