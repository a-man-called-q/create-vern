import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setEnvValue } from "../system/env-file";
import type { Logger } from "../system/io";
import { capture, stream } from "../system/process";
import { LOGIN_DOCKERFILE, UPSTREAM_VERSION_FILE } from "./layout";

/** Where the project keeps the auth stack's environment, relative to its root. */
const AUTH_SERVER = join("apps", "auth-server");

/** Build the Login App in `dir` as `image`. False, with a warning, when it could not be built. */
export function buildImage(dir: string, image: string, logger: Logger): boolean {
	if (capture("docker", ["info"]).status !== 0) {
		logger.warn("Docker is not running, so the login image was not built.");
		return false;
	}
	logger.log(`Building ${image} (this takes a few minutes the first time)`);
	const status = stream("docker", ["build", "-f", LOGIN_DOCKERFILE, "-t", image, "."], {
		cwd: dir,
	});
	if (status !== 0) {
		logger.warn("The login image build failed, so the auth stack keeps the published image.");
		return false;
	}
	return true;
}

function readFirstExisting(paths: string[]): string {
	const found = paths.find((path) => existsSync(path));
	if (!found) return "";
	return readFileSync(found, "utf8");
}

/**
 * Make the auth stack run `image`, on the ZITADEL version the checkout in
 * `loginDir` was built for. Starts from the project's `.env`, or from its
 * example when there is none yet, and returns the file it wrote.
 */
export function pointAuthStackAt(projectRoot: string, loginDir: string, image: string): string {
	const envFile = join(projectRoot, AUTH_SERVER, ".env");
	let env = readFirstExisting([envFile, `${envFile}.example`]);
	const versionFile = join(loginDir, UPSTREAM_VERSION_FILE);
	if (existsSync(versionFile)) {
		env = setEnvValue(env, "ZITADEL_VERSION", readFileSync(versionFile, "utf8").trim());
	}
	env = setEnvValue(env, "ZITADEL_LOGIN_IMAGE", image);
	writeFileSync(envFile, env);
	return envFile;
}
