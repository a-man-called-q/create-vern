import { existsSync } from "node:fs";
import { join } from "node:path";
import { requireProjectRoot } from "../project/config";
import { UserError } from "../system/errors";
import { stream } from "../system/process";
import { findBun } from "../system/toolchain";

/** Relative to the project root, which is where Bun runs it. */
const UPDATE_SCRIPT = "scripts/update-project.ts";

/**
 * Run the project's own `scripts/update-project.ts`, so the update logic always
 * matches the template the project was created from. Returns its exit code.
 */
export function updateProject(flags: string[], cwd: string): number {
	const root = requireProjectRoot(cwd);
	const script = join(root, UPDATE_SCRIPT);
	if (!existsSync(script)) {
		throw new UserError(
			`${script} does not exist. This project cannot be updated with create-vern.`,
		);
	}
	const bun = findBun();
	if (!bun) {
		throw new UserError(
			"Bun is required to run the update. Run `proto install` in the project, or install Bun from https://bun.sh.",
		);
	}
	return stream(bun, [UPDATE_SCRIPT, ...flags], { cwd: root });
}
