import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { type LoginOptions, setupLogin } from "../../src/login/setup-login";
import {
	fakeDocker,
	git,
	isolateGit,
	makeLoginRepo,
	recordingIo,
	tempDir,
	withPath,
	write,
} from "../helpers";

isolateGit();

/** Options that clone `url` into `dir` without building the image. */
function loginOptions(dir: string, url: string, extra: Partial<LoginOptions> = {}): LoginOptions {
	return { build: false, cwd: process.cwd(), dir, url, ...extra };
}

describe("setupLogin", () => {
	test("keeps the published image when the build fails", async () => {
		const login = makeLoginRepo();
		const docker = fakeDocker(1);
		await withPath(docker.bin, () => {
			const project = tempDir();
			write(project, "apps/auth-server/.env.example", "ZITADEL_LOGIN_IMAGE=published\n");
			const io = recordingIo();
			setupLogin(project, "acme", loginOptions(join(tempDir(), "l"), login.url, { build: true }), io);
			expect(existsSync(join(project, "apps/auth-server/.env"))).toBe(false);
			expect(io.warnings.join("\n")).toContain("build failed");
		});
	});

	test("reuses a login checkout that is already there", () => {
		const login = makeLoginRepo();
		const dir = join(tempDir(), "existing");
		const io = recordingIo();
		setupLogin(tempDir(), "acme", loginOptions(dir, login.url), io);
		setupLogin(tempDir(), "acme", loginOptions(dir, login.url), io);
		expect(io.lines.join("\n")).toContain("Using the existing");
	});

	test("leaves the checkout without a remote but with its history and tags", () => {
		const login = makeLoginRepo();
		const dir = join(tempDir(), "own");
		setupLogin(tempDir(), "acme", loginOptions(dir, login.url), recordingIo());
		expect(git(dir, "remote")).toBe("");
		expect(git(dir, "rev-parse", "HEAD")).toBe(git(login.dir, "rev-parse", "HEAD"));
		expect(git(dir, "tag", "-l")).toBe("upstream/v9.9.9");
	});

	test("detaches an existing checkout from Vern, and keeps a remote of your own", () => {
		const login = makeLoginRepo();
		const dir = join(tempDir(), "existing");
		git(dirname(dir), "clone", "--quiet", login.url, dir);
		setupLogin(tempDir(), "acme", loginOptions(dir, login.url), recordingIo());
		expect(git(dir, "remote")).toBe("");

		git(dir, "remote", "add", "origin", "https://example.com/acme/acme-login.git");
		setupLogin(tempDir(), "acme", loginOptions(dir, login.url), recordingIo());
		expect(git(dir, "remote", "get-url", "origin")).toBe("https://example.com/acme/acme-login.git");
	});

	test("refuses to overwrite a folder that is not a login checkout", () => {
		const dir = tempDir();
		write(dir, "notes.txt", "mine");
		expect(() =>
			setupLogin(tempDir(), "acme", loginOptions(dir, "file:///nope"), recordingIo()),
		).toThrow(/not a vern-zitadel-login checkout/);
	});

	test("names the checkout relative to the given working directory", () => {
		const login = makeLoginRepo();
		const cwd = tempDir();
		const io = recordingIo();
		setupLogin(tempDir(), "acme", loginOptions(join(cwd, "acme-login"), login.url, { cwd }), io);
		expect(io.lines.join("\n")).toContain("Edit the login in acme-login/apps/login/src");
	});
});
