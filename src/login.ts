import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { Io } from "./prompt";
import { capture, git, stream, UserError } from "./system";

export const DEFAULT_LOGIN_URL = "https://github.com/a-man-called-q/vern-zitadel-login.git";

export interface LoginOptions {
	/** Build the image and point the auth stack at it. */
	build: boolean;
	/** Where to clone; defaults to `<slug>-login` next to the project. */
	dir?: string;
	/** Repository to clone; tests point this at a local fixture. */
	url?: string;
}

/** Set `KEY=value`, replacing the existing line or appending one. */
export function setEnvValue(content: string, key: string, value: string): string {
	const line = `${key}=${value}`;
	const pattern = new RegExp(`^${key}=.*$`, "m");
	if (pattern.test(content)) return content.replace(pattern, () => line);
	return `${content}${content.endsWith("\n") || content === "" ? "" : "\n"}${line}\n`;
}

function cloneLogin(url: string, dir: string, io: Io): void {
	if (existsSync(dir)) {
		if (existsSync(join(dir, ".vern", "login.Dockerfile"))) {
			io.log(`Using the existing ${dir}`);
			return;
		}
		throw new UserError(`${dir} already exists and is not a vern-zitadel-login checkout.`);
	}
	io.log(`Cloning vern-zitadel-login into ${dir}`);
	git(dirname(dir), ["clone", "--quiet", url, dir], "Cloning vern-zitadel-login");
}

/**
 * Stop the checkout from following Vern's repository, so it is the project's
 * own from the start. The history and the `upstream/*` tags stay: the ZITADEL
 * sync workflow merges new releases on top of them. A checkout whose `origin`
 * already points somewhere else is left alone.
 */
function detachLogin(url: string, dir: string): void {
	const origin = capture("git", ["remote", "get-url", "origin"], { cwd: dir });
	if (origin.status === 0 && origin.stdout.trim() === url) {
		git(dir, ["remote", "remove", "origin"], "Removing the Vern remote");
	}
}

function buildImage(dir: string, image: string, io: Io): boolean {
	if (capture("docker", ["info"]).status !== 0) {
		io.warn("Docker is not running, so the login image was not built.");
		return false;
	}
	io.log(`Building ${image} (this takes a few minutes the first time)`);
	const status = stream("docker", ["build", "-f", ".vern/login.Dockerfile", "-t", image, "."], {
		cwd: dir,
	});
	if (status !== 0) {
		io.warn("The login image build failed, so the auth stack keeps the published image.");
		return false;
	}
	return true;
}

/**
 * Put the Login App source next to the project and, when it builds, point the
 * auth stack at the result. The project keeps working with the published image
 * if any step here fails.
 */
export function setupLogin(
	projectRoot: string,
	slug: string,
	options: LoginOptions,
	io: Io,
): void {
	const dir = options.dir ?? join(dirname(projectRoot), `${slug}-login`);
	const image = `${slug}-login:local`;
	const url = options.url ?? DEFAULT_LOGIN_URL;
	cloneLogin(url, dir, io);
	detachLogin(url, dir);

	const envDir = join(projectRoot, "apps", "auth-server");
	if (options.build && buildImage(dir, image, io)) {
		const example = join(envDir, ".env.example");
		const target = join(envDir, ".env");
		const source = existsSync(target) ? target : example;
		let env = existsSync(source) ? readFileSync(source, "utf8") : "";
		const versionFile = join(dir, ".vern", "UPSTREAM_VERSION");
		if (existsSync(versionFile)) {
			env = setEnvValue(env, "ZITADEL_VERSION", readFileSync(versionFile, "utf8").trim());
		}
		env = setEnvValue(env, "ZITADEL_LOGIN_IMAGE", image);
		writeFileSync(target, env);
		io.log(`Set ZITADEL_LOGIN_IMAGE=${image} in ${relative(projectRoot, target)}`);
	}

	const shown = relative(process.cwd(), dir) || basename(dir);
	io.log(
		[
			"",
			`Edit the login in ${shown}/apps/login/src, then rebuild and restart:`,
			`  docker build -f .vern/login.Dockerfile -t ${image} .   (in ${shown})`,
			"  moon run auth-server:dev                                (in the project)",
			"",
			`${shown} is yours: it keeps the Login App's history and has no remote. To deploy`,
			"your login, push it to a repository of your own, with the tags the ZITADEL",
			"sync merges from:",
			"  git remote add origin <your repository>",
			"  git push -u origin main --tags",
			"Then run \"Publish Login image\" there once, make the package public (or docker",
			"login ghcr.io where the stack runs), and set ZITADEL_LOGIN_IMAGE to the",
			`published tag. Details: ${shown}/.github/README.md.`,
		].join("\n"),
	);
}
