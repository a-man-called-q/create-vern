import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { Io } from "./prompt";
import { capture, commandExists, git, stream, UserError } from "./system";

export const DEFAULT_LOGIN_URL = "https://github.com/a-man-called-q/vern-zitadel-login.git";

export interface LoginOptions {
	/** Fork the repository on GitHub with `gh` and point `origin` at the fork. */
	fork: boolean;
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

function forkLogin(dir: string, io: Io): void {
	if (!commandExists("gh") || capture("gh", ["auth", "status"]).status !== 0) {
		io.warn(
			`The GitHub CLI is missing or not signed in, so ${dir} still points at the Vern repository. Create your own repository and run \`git remote set-url origin <url>\` there.`,
		);
		return;
	}
	io.log("Forking vern-zitadel-login to your GitHub account");
	if (stream("gh", ["repo", "fork", "--remote"], { cwd: dir }) !== 0) {
		io.warn(
			`Could not fork the repository (you cannot fork your own). ${dir} still points at the Vern repository.`,
		);
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
	cloneLogin(options.url ?? DEFAULT_LOGIN_URL, dir, io);
	if (options.fork) forkLogin(dir, io);

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
			"To deploy your login, publish an image from your fork. Its publish workflow",
			"(.github/workflows/publish.yml) is pinned to the Vern repository: change the",
			"repository guard and the image name there, push, and set ZITADEL_LOGIN_IMAGE",
			"to the published tag.",
		].join("\n"),
	);
}
