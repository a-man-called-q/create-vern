import { requireProjectRoot } from "../project/config";
import { UserError } from "../system/errors";
import { stream } from "../system/process";
import { findBun } from "../system/toolchain";

/**
 * What Bun runs for an update. Without `cli` it is the newest CLI on npm, not
 * the one the project has installed: the update that brings a change is the
 * one that knows how to apply it. It is also what moves a project from before
 * the CLI, which has the same code in `scripts/`. `cli` is the entry of a CLI
 * on this machine (`packages/cli/src/bin.ts` of a checkout of Vern) to run
 * instead.
 */
export function updateCommand(cli?: string): string[] {
	return cli ? [cli, "project:update"] : ["x", "@tsanyqudsi/vern@latest", "project:update"];
}

/**
 * Run Vern's update in the project `cwd` is in, with `flags` as given. Returns
 * its exit code.
 */
export function updateProject(flags: string[], cwd: string, cli?: string): number {
	const root = requireProjectRoot(cwd);
	const bun = findBun();
	if (!bun) {
		throw new UserError(
			"Bun is required to run the update. Run `proto install` in the project, or install Bun from https://bun.sh.",
		);
	}
	return stream(bun, [...updateCommand(cli), ...flags], { cwd: root });
}
