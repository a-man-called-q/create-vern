import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export interface Captured {
	status: number;
	stdout: string;
	stderr: string;
}

interface RunOptions {
	cwd?: string;
}

/**
 * The current environment, plus the folders proto and Bun install into. A
 * shell that has not been restarted since the install does not have them on
 * PATH yet.
 */
export function toolEnv(): NodeJS.ProcessEnv {
	const home = homedir();
	const extra = [
		join(home, ".proto", "shims"),
		join(home, ".proto", "bin"),
		join(home, ".bun", "bin"),
	].filter((dir) => existsSync(dir));
	return {
		...process.env,
		PATH: [process.env.PATH ?? "", ...extra].filter(Boolean).join(delimiter),
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
		env: toolEnv(),
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
		env: toolEnv(),
		stdio: "inherit",
	});
	if (result.error) return 127;
	return result.status ?? 1;
}

export function commandExists(command: string): boolean {
	return capture(command, ["--version"]).status === 0;
}
