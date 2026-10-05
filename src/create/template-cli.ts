import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The source of the template's CLI, which a rename removes: a project installs the package. */
const CLI_SOURCE = "packages/cli";
const CLI_ENTRY = "src/bin.ts";
/** Where a release of Vern from before the CLI has the same commands. */
const RENAME_SCRIPT = "scripts/rename-project.ts";
const STACK_SCRIPT = "scripts/stack-project.ts";

/** What Bun runs in the staging folder, in front of a command's options. */
export interface TemplateCommands {
	rename: string[];
	/** Missing in a release of Vern from before it could choose how the environments run. */
	stack?: string[];
	/** Delete the copy of the CLI, when there is one. */
	dispose(): void;
}

/**
 * The template's own rename and stack commands, so their logic always matches
 * the release that was copied. The CLI works on the project it is run in, so
 * it runs from a copy outside the staging folder: the rename needs a clean
 * tree and removes the source, and the stack is chosen after it.
 */
export function templateCommands(stage: string): TemplateCommands {
	if (!existsSync(join(stage, CLI_SOURCE, CLI_ENTRY))) {
		return {
			rename: [RENAME_SCRIPT],
			stack: existsSync(join(stage, STACK_SCRIPT)) ? [STACK_SCRIPT] : undefined,
			dispose: () => {},
		};
	}
	const copy = mkdtempSync(join(tmpdir(), "create-vern-cli-"));
	cpSync(join(stage, CLI_SOURCE), copy, { recursive: true });
	const entry = join(copy, CLI_ENTRY);
	return {
		rename: [entry, "project:rename"],
		stack: [entry, "project:stack"],
		dispose: () => rmSync(copy, { recursive: true, force: true }),
	};
}
