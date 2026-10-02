import { basename, relative } from "node:path";
import { setupLogin } from "../login/setup-login";
import { errorMessage, UserError } from "../system/errors";
import type { Io, Logger } from "../system/io";
import { commandExists } from "../system/process";
import { installToolchain } from "../system/toolchain";
import {
	choosePrompter,
	resolveIdentity,
	resolveLoginChoice,
	resolveTarget,
} from "./questions";
import { scaffoldProject } from "./scaffold";
import { DEFAULT_TEMPLATE_URL, resolveRef } from "./template";

export interface CreateOptions {
	/** The folder a relative `dir` and the printed paths are relative to. */
	cwd: string;
	dir?: string;
	name?: string;
	slug?: string;
	/** Tag, branch, or commit of the template; defaults to the latest release. */
	ref?: string;
	/** `undefined` asks (or answers no without a terminal). */
	login?: boolean;
	buildLogin: boolean;
	install: boolean;
	/** Take the defaults instead of asking. */
	yes: boolean;
	/** Another copy of the template; tests point this at a local fixture. */
	templateUrl?: string;
	/** Another copy of the Login App; tests point this at a local fixture. */
	loginUrl?: string;
}

/** The login is optional: when it stops, the project is still complete. */
function setupLoginOrWarn(
	target: string,
	slug: string,
	options: CreateOptions,
	logger: Logger,
): void {
	try {
		setupLogin(
			target,
			slug,
			{ build: options.buildLogin, cwd: options.cwd, url: options.loginUrl },
			logger,
		);
	} catch (error) {
		logger.warn(
			`Login setup stopped: ${errorMessage(error)}\nThe project itself is ready; run \`create-vern login\` inside it to try again.`,
		);
	}
}

function nextSteps(name: string, shown: string, installed: boolean): string {
	const lines = ["", `Created ${name} in ${shown}. Next:`, "", `  cd ${shown}`];
	if (!installed) lines.push("  proto install && bun install");
	lines.push(
		"  moon generate tanstack -- --name web --port 3000    # or: moon generate next -- --name web --port 3000",
		"  bun run setup                                        # starts ZITADEL and wires the app to it",
		"  moon run :dev",
		"",
		"Update later with: npx create-vern update",
	);
	return lines.join("\n");
}

/** Create the project already renamed, with its own history, and install it. */
export async function createProject(options: CreateOptions, io: Io): Promise<void> {
	if (!commandExists("git")) throw new UserError("Git is required.");
	const prompter = choosePrompter(io, options.yes);
	const target = await resolveTarget(options.dir, options.cwd, prompter);
	const identity = await resolveIdentity(options, basename(target), prompter);
	const wantLogin = await resolveLoginChoice(options.login, prompter);
	const templateUrl = options.templateUrl ?? DEFAULT_TEMPLATE_URL;
	const ref = resolveRef(templateUrl, options.ref);

	scaffoldProject({ target, identity, templateUrl, ref }, io);
	if (options.install) installToolchain(target, io);
	if (wantLogin) setupLoginOrWarn(target, identity.slug, options, io);
	io.log(nextSteps(identity.name, relative(options.cwd, target) || ".", options.install));
}
