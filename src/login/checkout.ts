import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { UserError } from "../system/errors";
import { git } from "../system/git";
import type { Logger } from "../system/io";
import { capture } from "../system/process";
import { LOGIN_DOCKERFILE } from "./layout";

/** Clone the Login App into `dir`, or keep the checkout that is already there. */
export function cloneLogin(url: string, dir: string, logger: Logger): void {
	if (!existsSync(dir)) {
		logger.log(`Cloning vern-zitadel-login into ${dir}`);
		git(dirname(dir), ["clone", "--quiet", url, dir], "Cloning vern-zitadel-login");
		return;
	}
	if (!existsSync(join(dir, LOGIN_DOCKERFILE))) {
		throw new UserError(`${dir} already exists and is not a vern-zitadel-login checkout.`);
	}
	logger.log(`Using the existing ${dir}`);
}

/**
 * Stop the checkout from following Vern's repository, so it is the project's
 * own from the start. The history and the `upstream/*` tags stay: the ZITADEL
 * sync workflow merges new releases on top of them. A checkout whose `origin`
 * already points somewhere else is left alone.
 */
export function detachLogin(url: string, dir: string): void {
	const origin = capture("git", ["remote", "get-url", "origin"], { cwd: dir });
	if (origin.status === 0 && origin.stdout.trim() === url) {
		git(dir, ["remote", "remove", "origin"], "Removing the Vern remote");
	}
}
