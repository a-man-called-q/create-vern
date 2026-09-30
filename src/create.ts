import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { type LoginOptions, setupLogin } from "./login";
import type { Io } from "./prompt";
import {
	capture,
	commandExists,
	findBun,
	git,
	gitIdentityArgs,
	stream,
	UserError,
} from "./system";
import { DEFAULT_TEMPLATE_URL, fetchTemplate, resolveRef } from "./template";

export interface CreateOptions {
	dir?: string;
	name?: string;
	slug?: string;
	/** Tag, branch, or commit of the template; defaults to the latest release. */
	ref?: string;
	/** `undefined` asks (or answers no without a terminal). */
	login?: boolean;
	fork: boolean;
	buildLogin: boolean;
	install: boolean;
	/** Take the defaults instead of asking. */
	yes: boolean;
	/** Tests point these at local fixtures. */
	templateUrl?: string;
	loginUrl?: string;
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function displayName(slug: string): string {
	return slug
		.split("-")
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/** The template's own rules, checked here first so a bad name fails before any download. */
export function validateIdentity(name: string, slug: string): void {
	if (!/^[\p{L}\p{N}][\p{L}\p{N} .-]*$/u.test(name.trim())) {
		throw new UserError(
			"The name may contain letters, numbers, spaces, periods, and hyphens.",
		);
	}
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
		throw new UserError(
			"The slug must be lowercase kebab-case (for example, acme-platform).",
		);
	}
}

async function resolveTarget(options: CreateOptions, io: Io): Promise<string> {
	let dir = options.dir;
	if (!dir) {
		if (!io.interactive || options.yes) {
			throw new UserError("Provide a project directory: create-vern <directory>.");
		}
		dir = await io.ask("Project directory", "my-vern-app");
	}
	const target = resolve(dir);
	if (existsSync(target) && readdirSync(target).length > 0) {
		throw new UserError(`${target} already exists and is not empty.`);
	}
	return target;
}

async function resolveIdentity(
	options: CreateOptions,
	io: Io,
	folder: string,
): Promise<{ name: string; slug: string }> {
	const ask = io.interactive && !options.yes;
	const derivedSlug = options.slug ?? (options.name ? slugify(options.name) : slugify(folder));
	let name = options.name ?? displayName(derivedSlug);
	if (ask && !options.name) name = await io.ask("Project name", name);
	let slug = options.slug ?? slugify(name);
	if (ask && !options.slug) slug = await io.ask("Package slug", slug);
	if (!slug) {
		throw new UserError("Could not derive a slug from the name. Pass --slug <kebab-case>.");
	}
	validateIdentity(name, slug);
	return { name: name.trim(), slug };
}

function ensureBun(cwd: string, io: Io): string {
	const found = findBun();
	if (found) return found;
	if (commandExists("proto")) {
		io.log("Bun not found; installing the pinned version with proto");
		if (stream("proto", ["install", "bun"], { cwd }) === 0) {
			const installed = findBun();
			if (installed) return installed;
		}
	}
	throw new UserError(
		"Bun is required. Install proto (https://moonrepo.dev/docs/proto/install) and rerun, or install Bun from https://bun.sh.",
	);
}

function commit(cwd: string, message: string): void {
	git(cwd, ["add", "-A"], "Staging files");
	git(cwd, [...gitIdentityArgs(cwd), "commit", "--quiet", "-m", message], "Committing");
}

function initRepository(cwd: string, message: string, io: Io): void {
	if (capture("git", ["init", "--quiet", "-b", "main"], { cwd }).status !== 0) {
		git(cwd, ["init", "--quiet"], "Creating the repository");
		git(cwd, ["symbolic-ref", "HEAD", "refs/heads/main"], "Naming the branch");
	}
	if (gitIdentityArgs(cwd).length > 0) {
		io.warn("Git has no user.name/user.email; committing as create-vern.");
	}
	commit(cwd, message);
}

/**
 * Copy the template into a staging folder next to `target`, rename it there,
 * and move it into place with a single commit. Returns the Bun that ran the
 * rename. A failure leaves nothing behind.
 * The staging folder sits beside the target so the final move stays on one
 * filesystem.
 */
function buildProject(
	target: string,
	identity: { name: string; slug: string },
	templateUrl: string,
	ref: ReturnType<typeof resolveRef>,
	io: Io,
): string {
	mkdirSync(dirname(target), { recursive: true });
	const stage = mkdtempSync(join(dirname(target), ".create-vern-"));
	try {
		io.log(`Copying Vern (${ref.label}) into ${target}`);
		const sha = fetchTemplate(templateUrl, ref, stage);

		// The template's rename script works on a Git checkout (clean tree, recorded
		// baseline), so the copy gets a throwaway repository for the rename only.
		const bun = ensureBun(stage, io);
		initRepository(stage, "chore: stage the template", { ...io, warn: () => {} });
		io.log(`Renaming Vern to ${identity.name} (${identity.slug})`);
		const renamed = stream(
			bun,
			[
				"scripts/rename-project.ts",
				"--name",
				identity.name,
				"--slug",
				identity.slug,
				"--base",
				sha,
				"--apply",
			],
			{ cwd: stage },
		);
		if (renamed !== 0) {
			throw new UserError("The rename failed, so no project was created.");
		}

		// The project starts here: one commit that is already renamed. The updater
		// fetches Vern itself, so the staging history is not needed.
		rmSync(join(stage, ".git"), { recursive: true, force: true });
		initRepository(stage, `chore: initial commit from Vern ${sha.slice(0, 7)}`, io);

		if (existsSync(target)) rmdirSync(target);
		renameSync(stage, target);
		return bun;
	} catch (error) {
		rmSync(stage, { recursive: true, force: true });
		throw error;
	}
}

/** Create the project already renamed, with its own history, and install it. */
export async function createProject(options: CreateOptions, io: Io): Promise<void> {
	if (!commandExists("git")) throw new UserError("Git is required.");
	const target = await resolveTarget(options, io);
	const { name, slug } = await resolveIdentity(options, io, basename(target));
	const wantLogin =
		options.login ??
		(io.interactive && !options.yes
			? await io.confirm(
					"Customize the login page layout? (forks vern-zitadel-login next to the project; colors and text can be changed without it)",
					false,
				)
			: false);
	const templateUrl =
		options.templateUrl ?? process.env.CREATE_VERN_TEMPLATE_URL ?? DEFAULT_TEMPLATE_URL;
	const ref = resolveRef(templateUrl, options.ref);
	const bun = buildProject(target, { name, slug }, templateUrl, ref, io);

	if (options.install) {
		if (commandExists("proto")) {
			io.log("Installing the toolchain (proto install)");
			if (stream("proto", ["install"], { cwd: target }) !== 0) {
				io.warn("proto install failed; run it again in the project.");
			}
		} else {
			io.warn("proto is not installed; see https://moonrepo.dev/docs/proto/install, then run `proto install` in the project.");
		}
		io.log("Installing dependencies (bun install)");
		if (stream(bun, ["install"], { cwd: target }) !== 0) {
			io.warn("bun install failed; run it again in the project.");
		}
	}

	if (wantLogin) {
		const login: LoginOptions = {
			fork: options.fork,
			build: options.buildLogin,
			url: options.loginUrl,
		};
		try {
			setupLogin(target, slug, login, io);
		} catch (error) {
			io.warn(
				`Login setup stopped: ${error instanceof Error ? error.message : String(error)}\nThe project itself is ready; run \`create-vern login\` inside it to try again.`,
			);
		}
	}

	const shown = relative(process.cwd(), target) || ".";
	io.log(
		[
			"",
			`Created ${name} in ${shown}. Next:`,
			"",
			`  cd ${shown}`,
			...(options.install ? [] : ["  proto install && bun install"]),
			"  moon generate tanstack -- --name web --port 3000    # or: moon generate next -- --name web --port 3000",
			"  bun run setup                                        # starts ZITADEL and wires the app to it",
			"  moon run :dev",
			"",
			"Update later with: npx create-vern update",
		].join("\n"),
	);
}
