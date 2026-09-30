import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** An error whose message is meant for the person running the CLI. */
export class UserError extends Error {}

export interface Captured {
	status: number;
	stdout: string;
	stderr: string;
}

interface RunOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * The current environment, plus the folders proto and Bun install into. A
 * shell that has not been restarted since the install does not have them on
 * PATH yet.
 */
export function toolEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const home = homedir();
	const extra = [
		join(home, ".proto", "shims"),
		join(home, ".proto", "bin"),
		join(home, ".bun", "bin"),
	].filter((dir) => existsSync(dir));
	return {
		...base,
		PATH: [base.PATH ?? "", ...extra].filter(Boolean).join(delimiter),
	};
}

/** Run a command and collect its output. Never throws. */
export function capture(
	command: string,
	args: string[],
	options: RunOptions = {},
): Captured {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: options.env ?? toolEnv(),
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	});
	if (result.error) {
		return { status: 127, stdout: "", stderr: result.error.message };
	}
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

/** Run a command with its output going straight to the terminal. */
export function stream(
	command: string,
	args: string[],
	options: RunOptions = {},
): number {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: options.env ?? toolEnv(),
		stdio: "inherit",
	});
	if (result.error) return 127;
	return result.status ?? 1;
}

export function commandExists(command: string): boolean {
	return capture(command, ["--version"]).status === 0;
}

/** The Bun that runs the project's scripts; the one running us when it is Bun. */
export function findBun(): string | undefined {
	if (process.versions.bun) return process.execPath;
	return commandExists("bun") ? "bun" : undefined;
}

export function git(cwd: string, args: string[], what: string): string {
	const result = capture("git", args, { cwd });
	if (result.status !== 0) {
		const detail = result.stderr.trim() || `git ${args[0]} exited with ${result.status}`;
		throw new UserError(`${what} failed: ${detail}`);
	}
	return result.stdout.trim();
}

/**
 * `-c` flags that give commits an author when Git has none configured, so a
 * fresh machine can still create the project.
 */
export function gitIdentityArgs(cwd?: string): string[] {
	const configured = (key: string) =>
		capture("git", ["config", key], { cwd }).stdout.trim() !== "";
	if (configured("user.name") && configured("user.email")) return [];
	return [
		"-c",
		"user.name=create-vern",
		"-c",
		"user.email=create-vern@users.noreply.github.com",
	];
}
