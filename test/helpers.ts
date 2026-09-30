import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Io } from "../src/prompt";
import { capture } from "../src/system";

export function tempDir(prefix = "create-vern-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

export function write(root: string, path: string, content: string): void {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

export function git(cwd: string, ...args: string[]): string {
	const result = capture("git", args, { cwd });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
}

/** Commit everything in `dir` as a fixture author and return the commit. */
export function commitAll(dir: string, message: string): string {
	git(dir, "add", "-A");
	git(
		dir,
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.com",
		"commit",
		"--quiet",
		"-m",
		message,
	);
	return git(dir, "rev-parse", "HEAD");
}

/**
 * A stand-in for the Vern template: the same layout the installer relies on
 * (a rename script that records `.vern/config.json`) without the real content.
 */
export function makeTemplate(): { url: string; dir: string; sha: string } {
	const dir = tempDir("template-");
	git(dir, "init", "--quiet", "-b", "main");
	write(dir, ".gitignore", "node_modules/\n**/.env\n");
	write(dir, "README.md", "# Vern\n");
	write(dir, "apps/auth-server/.env.example", "ZITADEL_VERSION=v1.0.0\nZITADEL_LOGIN_IMAGE=example/login:v1.0.0\n");
	write(
		dir,
		"scripts/rename-project.ts",
		`import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
mkdirSync(".vern", { recursive: true });
writeFileSync(".vern/config.json", JSON.stringify({
	schemaVersion: 1,
	project: { name: value("--name"), slug: value("--slug") },
	upstream: { lastSyncedSha: value("--base"), apply: args.includes("--apply") },
}));
writeFileSync("README.md", readFileSync("README.md", "utf8").replace("Vern", value("--name")));
`,
	);
	write(
		dir,
		"scripts/update-project.ts",
		'import { writeFileSync } from "node:fs";\nwriteFileSync("update-ran.txt", process.argv.slice(2).join(" "));\n',
	);
	const first = commitAll(dir, "first");
	git(dir, "tag", "v0.2.0");
	write(dir, "CHANGELOG.md", "second\n");
	commitAll(dir, "second");
	git(dir, "tag", "v0.10.0");
	git(dir, "tag", "v0.11.0-beta.1");
	return { url: pathToFileURL(dir).href, dir, sha: first };
}

/** A stand-in for vern-zitadel-login. */
export function makeLoginRepo(): { url: string; dir: string } {
	const dir = tempDir("login-");
	git(dir, "init", "--quiet", "-b", "main");
	write(dir, ".vern/UPSTREAM_VERSION", "v9.9.9\n");
	write(dir, ".vern/login.Dockerfile", "FROM scratch\n");
	commitAll(dir, "login");
	return { url: pathToFileURL(dir).href, dir };
}

/** Records what it was asked to do, instead of running Docker. Only `build` can fail. */
export function fakeDocker(exitCode = 0): { bin: string; log: string } {
	const bin = tempDir("bin-");
	const log = join(bin, "docker.log");
	write(
		bin,
		"docker",
		`#!/bin/sh\necho "$@" >> "${log}"\ncase "$1" in build) exit ${exitCode};; esac\nexit 0\n`,
	);
	chmodSync(join(bin, "docker"), 0o755);
	return { bin, log };
}

export function recordingIo(overrides: Partial<Io> = {}): Io & { lines: string[]; warnings: string[] } {
	const lines: string[] = [];
	const warnings: string[] = [];
	return {
		interactive: false,
		log: (message) => lines.push(message),
		warn: (message) => warnings.push(message),
		ask: async (_question, fallback) => fallback,
		confirm: async (_question, fallback) => fallback,
		...overrides,
		lines,
		warnings,
	};
}
