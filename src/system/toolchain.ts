import { UserError } from "./errors";
import type { Logger } from "./io";
import { commandExists, stream } from "./process";

/** The Bun that runs the project's scripts; the one running us when it is Bun. */
export function findBun(): string | undefined {
	if (process.versions.bun) return process.execPath;
	if (commandExists("bun")) return "bun";
	return undefined;
}

function installBunWithProto(cwd: string, logger: Logger): string | undefined {
	if (!commandExists("proto")) return undefined;
	logger.log("Bun not found; installing the pinned version with proto");
	if (stream("proto", ["install", "bun"], { cwd }) !== 0) return undefined;
	return findBun();
}

/** Find Bun, installing the version pinned in `cwd` with proto when it is missing. */
export function ensureBun(cwd: string, logger: Logger): string {
	const bun = findBun() ?? installBunWithProto(cwd, logger);
	if (!bun) {
		throw new UserError(
			"Bun is required. Install proto (https://moonrepo.dev/docs/proto/install) and rerun, or install Bun from https://bun.sh.",
		);
	}
	return bun;
}

function installPinnedTools(cwd: string, logger: Logger): void {
	if (!commandExists("proto")) {
		logger.warn(
			"proto is not installed; see https://moonrepo.dev/docs/proto/install, then run `proto install` in the project.",
		);
		return;
	}
	logger.log("Installing the toolchain (proto install)");
	if (stream("proto", ["install"], { cwd }) !== 0) {
		logger.warn("proto install failed; run it again in the project.");
	}
}

function installDependencies(cwd: string, logger: Logger): void {
	logger.log("Installing dependencies (bun install)");
	const bun = findBun();
	if (!bun || stream(bun, ["install"], { cwd }) !== 0) {
		logger.warn("bun install failed; run it again in the project.");
	}
}

/**
 * Install the toolchain pinned in `cwd` and its dependencies. A failure is a
 * warning: the project is already there, and the step can be run again.
 */
export function installToolchain(cwd: string, logger: Logger): void {
	installPinnedTools(cwd, logger);
	installDependencies(cwd, logger);
}
