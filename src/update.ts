import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findBun, stream, UserError } from "./system";

export const CONFIG_PATH = join(".vern", "config.json");

export interface ProjectConfig {
	name: string;
	slug: string;
}

/** The closest folder, from `start` upwards, that holds `.vern/config.json`. */
export function findProjectRoot(start: string): string | undefined {
	let current = resolve(start);
	for (;;) {
		if (existsSync(join(current, CONFIG_PATH))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

export function requireProjectRoot(start: string): string {
	const root = findProjectRoot(start);
	if (!root) {
		throw new UserError(
			`No ${CONFIG_PATH} found in ${resolve(start)} or above. Run this inside a project created with create-vern.`,
		);
	}
	return root;
}

export function readProjectConfig(root: string): ProjectConfig {
	const path = join(root, CONFIG_PATH);
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as {
			project?: { name?: unknown; slug?: unknown };
		};
		const { name, slug } = value.project ?? {};
		if (typeof name === "string" && typeof slug === "string" && name && slug) {
			return { name, slug };
		}
	} catch {
		// Falls through to the error below.
	}
	throw new UserError(`${path} is missing or has an unsupported format.`);
}

/**
 * Run the project's own `scripts/update-project.ts`, so the update logic always
 * matches the template the project was created from. Returns its exit code.
 */
export function updateProject(flags: string[], cwd: string): number {
	const root = requireProjectRoot(cwd);
	const script = join(root, "scripts", "update-project.ts");
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
	return stream(bun, ["scripts/update-project.ts", ...flags], { cwd: root });
}
