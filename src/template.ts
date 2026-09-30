import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { capture, git, UserError } from "./system";

export const DEFAULT_TEMPLATE_URL = "https://github.com/a-man-called-q/vern.git";

export type TemplateRef =
	| { kind: "head"; label: string }
	| { kind: "named"; value: string; label: string }
	| { kind: "sha"; value: string; label: string };

/** Compare `vX.Y.Z` tags numerically; anything else is not a release. */
function releaseParts(tag: string): [number, number, number] | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareParts(a: number[], b: number[]): number {
	return (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0);
}

/** The highest stable release tag in `git ls-remote --tags --refs` output. */
export function pickLatestTag(lsRemote: string): string | undefined {
	let best: { tag: string; parts: number[] } | undefined;
	for (const line of lsRemote.split(/\r?\n/)) {
		const ref = line.split("\t")[1];
		if (!ref?.startsWith("refs/tags/")) continue;
		const tag = ref.slice("refs/tags/".length);
		const parts = releaseParts(tag);
		if (parts && (!best || compareParts(parts, best.parts) > 0)) best = { tag, parts };
	}
	return best?.tag;
}

/**
 * Pick what to copy: the ref the user asked for, else the latest release tag,
 * else the default branch (until the template publishes releases).
 */
export function resolveRef(url: string, explicit?: string): TemplateRef {
	if (explicit) {
		if (/^[0-9a-f]{7,40}$/i.test(explicit)) {
			return { kind: "sha", value: explicit, label: explicit.slice(0, 7) };
		}
		return { kind: "named", value: explicit, label: explicit };
	}
	const listing = capture("git", ["ls-remote", "--tags", "--refs", url]);
	if (listing.status !== 0) {
		throw new UserError(
			`Could not reach ${url}: ${listing.stderr.trim() || "git ls-remote failed"}`,
		);
	}
	const tag = pickLatestTag(listing.stdout);
	return tag
		? { kind: "named", value: tag, label: tag }
		: { kind: "head", label: "the default branch" };
}

/**
 * Copy the template into `dest` without its history and return the commit it
 * was copied from. The project starts a new history; the commit is recorded as
 * the baseline that `update` later merges from.
 */
export function fetchTemplate(url: string, ref: TemplateRef, dest: string): string {
	mkdirSync(dirname(dest), { recursive: true });
	if (ref.kind === "sha") {
		git(dirname(dest), ["clone", "--quiet", url, dest], "Copying the template");
		git(dest, ["checkout", "--quiet", ref.value], `Checking out ${ref.value}`);
	} else {
		const args = ["clone", "--quiet", "--depth", "1"];
		if (ref.kind === "named") args.push("--branch", ref.value);
		git(dirname(dest), [...args, url, dest], "Copying the template");
	}
	const sha = git(dest, ["rev-parse", "HEAD"], "Reading the template commit");
	rmSync(join(dest, ".git"), { recursive: true, force: true });
	return sha;
}
