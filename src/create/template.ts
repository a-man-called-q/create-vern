import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { UserError } from "../system/errors";
import { git } from "../system/git";
import { capture } from "../system/process";

export const DEFAULT_TEMPLATE_URL = "https://github.com/a-man-called-q/vern.git";

export type TemplateRef =
	| { kind: "head"; label: string }
	| { kind: "named"; value: string; label: string }
	| { kind: "sha"; value: string; label: string };

type ReleaseParts = [number, number, number];

/** Compare `vX.Y.Z` tags numerically; anything else is not a release. */
function releaseParts(tag: string): ReleaseParts | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareParts(a: ReleaseParts, b: ReleaseParts): number {
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The highest stable release tag in `git ls-remote --tags --refs` output. */
export function pickLatestTag(lsRemote: string): string | undefined {
	let best: { tag: string; parts: ReleaseParts } | undefined;
	for (const line of lsRemote.split(/\r?\n/)) {
		const ref = line.split("\t")[1];
		if (!ref?.startsWith("refs/tags/")) continue;
		const tag = ref.slice("refs/tags/".length);
		const parts = releaseParts(tag);
		if (parts && (!best || compareParts(parts, best.parts) > 0)) best = { tag, parts };
	}
	return best?.tag;
}

/** A ref the user asked for: a commit when it looks like one, else a tag or branch. */
function explicitRef(ref: string): TemplateRef {
	if (/^[0-9a-f]{7,40}$/i.test(ref)) {
		return { kind: "sha", value: ref, label: ref.slice(0, 7) };
	}
	return { kind: "named", value: ref, label: ref };
}

/** The latest release tag, else the default branch (until the template publishes releases). */
function latestRelease(url: string): TemplateRef {
	const listing = capture("git", ["ls-remote", "--tags", "--refs", url]);
	if (listing.status !== 0) {
		throw new UserError(
			`Could not reach ${url}: ${listing.stderr.trim() || "git ls-remote failed"}`,
		);
	}
	const tag = pickLatestTag(listing.stdout);
	if (!tag) return { kind: "head", label: "the default branch" };
	return { kind: "named", value: tag, label: tag };
}

/** Pick what to copy: the ref the user asked for, else the latest release. */
export function resolveRef(url: string, explicit?: string): TemplateRef {
	if (explicit) return explicitRef(explicit);
	return latestRelease(url);
}

/** A commit is checked out of the full history; a tag or branch needs only its tip. */
function cloneArgs(ref: TemplateRef): string[] {
	if (ref.kind === "sha") return ["clone", "--quiet"];
	if (ref.kind === "named") return ["clone", "--quiet", "--depth", "1", "--branch", ref.value];
	return ["clone", "--quiet", "--depth", "1"];
}

/**
 * Copy the template into `dest` without its history and return the commit it
 * was copied from. The project starts a new history; the commit is recorded as
 * the baseline that `update` later merges from.
 */
export function fetchTemplate(url: string, ref: TemplateRef, dest: string): string {
	mkdirSync(dirname(dest), { recursive: true });
	git(dirname(dest), [...cloneArgs(ref), url, dest], "Copying the template");
	if (ref.kind === "sha") {
		git(dest, ["checkout", "--quiet", ref.value], `Checking out ${ref.value}`);
	}
	const sha = git(dest, ["rev-parse", "HEAD"], "Reading the template commit");
	rmSync(join(dest, ".git"), { recursive: true, force: true });
	return sha;
}
