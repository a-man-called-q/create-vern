import { existsSync, mkdirSync, mkdtempSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { UserError } from "../system/errors";
import { commitAll, initRepository, resolveCommitAuthor } from "../system/git";
import type { Logger } from "../system/io";
import { stream } from "../system/process";
import { ensureBun } from "../system/toolchain";
import { applyEnvironments, type Environments } from "./environments";
import type { ProjectIdentity } from "./identity";
import { fetchTemplate, type TemplateRef } from "./template";
import { templateCommands } from "./template-cli";

export interface ScaffoldRequest {
	/** The folder the project ends up in; missing or empty. */
	target: string;
	identity: ProjectIdentity;
	templateUrl: string;
	ref: TemplateRef;
	/** How each environment runs; without it the project keeps both ways. */
	environments?: Environments;
}

/**
 * Run `build` in a staging folder next to `target`, then move the folder into
 * place. A failure leaves nothing behind. The staging folder sits beside the
 * target so the final move stays on one filesystem.
 */
function withStage(target: string, build: (stage: string) => void): void {
	mkdirSync(dirname(target), { recursive: true });
	const stage = mkdtempSync(join(dirname(target), ".create-vern-"));
	try {
		build(stage);
		if (existsSync(target)) rmdirSync(target);
		renameSync(stage, target);
	} catch (error) {
		rmSync(stage, { recursive: true, force: true });
		throw error;
	}
}

/** Run the template's rename, recording `sha` as the commit the copy came from. */
function runRename(stage: string, bun: string, rename: string[], identity: ProjectIdentity, sha: string): void {
	const status = stream(
		bun,
		[...rename, "--name", identity.name, "--slug", identity.slug, "--base", sha, "--apply"],
		{ cwd: stage },
	);
	if (status !== 0) {
		throw new UserError("The rename failed, so no project was created.");
	}
}

/**
 * Copy the template, rename it, and put it at `target` as a new repository
 * with a single commit.
 */
export function scaffoldProject(request: ScaffoldRequest, logger: Logger): void {
	const { target, identity, templateUrl, ref, environments } = request;
	withStage(target, (stage) => {
		logger.log(`Copying Vern (${ref.label}) into ${target}`);
		const sha = fetchTemplate(templateUrl, ref, stage);
		const bun = ensureBun(stage, logger);

		const commands = templateCommands(stage);
		let author: ReturnType<typeof resolveCommitAuthor>;
		try {
			// The template's rename works on a Git checkout (clean tree, recorded
			// baseline), so the copy gets a throwaway repository for the rename only.
			initRepository(stage);
			author = resolveCommitAuthor(stage);
			commitAll(stage, "chore: stage the template", author);
			logger.log(`Renaming Vern to ${identity.name} (${identity.slug})`);
			runRename(stage, bun, commands.rename, identity, sha);

			// The project starts here: one commit that is already renamed. The updater
			// fetches Vern itself, so the staging history is not needed.
			rmSync(join(stage, ".git"), { recursive: true, force: true });
			// The first commit already holds only what the environments use.
			if (environments) applyEnvironments(stage, bun, commands.stack, environments, logger);
		} finally {
			commands.dispose();
		}
		initRepository(stage);
		if (author.fallback) {
			logger.warn("Git has no user.name/user.email; committing as create-vern.");
		}
		commitAll(stage, `chore: initial commit from Vern ${sha.slice(0, 7)}`, author);
	});
}
