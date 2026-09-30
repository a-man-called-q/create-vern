import { existsSync, readdirSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
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
	checkDocker?: boolean;
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

function requireDocker(): void {
	if (capture("docker", ["volume", "ls"]).status !== 0) {
		throw new UserError(
			"Docker is not running. The rename inspects Docker volumes so it cannot overwrite local auth data; start Docker and retry.",
		);
	}
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

/** Copy the template, give it its own identity and history, and install it. */
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
	if (options.checkDocker !== false) requireDocker();

	const templateUrl =
		options.templateUrl ?? process.env.CREATE_VERN_TEMPLATE_URL ?? DEFAULT_TEMPLATE_URL;
	const ref = resolveRef(templateUrl, options.ref);
	io.log(`Copying Vern (${ref.label}) into ${target}`);
	const sha = fetchTemplate(templateUrl, ref, target);

	const bun = ensureBun(target, io);
	initRepository(target, `chore: initial commit from Vern ${sha.slice(0, 7)}`, io);

	io.log(`Renaming Vern to ${name} (${slug})`);
	const renamed = stream(
		bun,
		["scripts/rename-project.ts", "--name", name, "--slug", slug, "--base", sha, "--apply"],
		{ cwd: target },
	);
	if (renamed !== 0) {
		throw new UserError(
			`The rename failed; the project is left in ${target} with the untouched template in its first commit.`,
		);
	}
	commit(target, `chore: rename Vern to ${name}`);

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
