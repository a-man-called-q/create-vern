import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { UserError } from "../system/errors";

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

/** The parsed file, or nothing when it is missing or not JSON. */
function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

function isFilled(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}

export function readProjectConfig(root: string): ProjectConfig {
	const path = join(root, CONFIG_PATH);
	const config = readJson(path) as { project?: { name?: unknown; slug?: unknown } } | null;
	const { name, slug } = config?.project ?? {};
	if (!isFilled(name) || !isFilled(slug)) {
		throw new UserError(`${path} is missing or has an unsupported format.`);
	}
	return { name, slug };
}
