import { basename, dirname, join, relative } from "node:path";
import type { Logger } from "../system/io";
import { cloneLogin, detachLogin } from "./checkout";
import { buildImage, pointAuthStackAt } from "./image";
import { LOGIN_DOCKERFILE } from "./layout";

export const DEFAULT_LOGIN_URL = "https://github.com/a-man-called-q/vern-zitadel-login.git";

export interface LoginOptions {
	/** Build the image and point the auth stack at it. */
	build: boolean;
	/** The folder the printed paths are relative to. */
	cwd: string;
	/** Where to clone; defaults to `<slug>-login` next to the project. */
	dir?: string;
	/** Repository to clone; tests point this at a local fixture. */
	url?: string;
}

function nextSteps(shown: string, image: string): string {
	return [
		"",
		`Edit the login in ${shown}/apps/login/src, then rebuild and restart:`,
		`  docker build -f ${LOGIN_DOCKERFILE} -t ${image} .   (in ${shown})`,
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
	].join("\n");
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
	logger: Logger,
): void {
	const dir = options.dir ?? join(dirname(projectRoot), `${slug}-login`);
	const image = `${slug}-login:local`;
	const url = options.url ?? DEFAULT_LOGIN_URL;
	cloneLogin(url, dir, logger);
	detachLogin(url, dir);

	if (options.build && buildImage(dir, image, logger)) {
		const envFile = pointAuthStackAt(projectRoot, dir, image);
		logger.log(`Set ZITADEL_LOGIN_IMAGE=${image} in ${relative(projectRoot, envFile)}`);
	}

	logger.log(nextSteps(relative(options.cwd, dir) || basename(dir), image));
}
