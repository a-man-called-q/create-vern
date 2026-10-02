import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { UserError } from "../system/errors";
import { acceptDefaults, type Prompter } from "../system/io";
import { displayName, type ProjectIdentity, slugify, validateIdentity } from "./identity";

const LOGIN_QUESTION =
	"Customize the login page layout? (copies vern-zitadel-login next to the project; colors and text can be changed without it)";

/** Who answers the questions: the person at the terminal, or the defaults. */
export function choosePrompter(prompter: Prompter, yes: boolean): Prompter {
	if (yes || !prompter.interactive) return acceptDefaults;
	return prompter;
}

async function askDirectory(prompter: Prompter): Promise<string> {
	if (!prompter.interactive) {
		throw new UserError("Provide a project directory: create-vern <directory>.");
	}
	return prompter.ask("Project directory", "my-vern-app");
}

/** The folder to create the project in, which must be new or empty. */
export async function resolveTarget(
	dir: string | undefined,
	cwd: string,
	prompter: Prompter,
): Promise<string> {
	const target = resolve(cwd, dir || (await askDirectory(prompter)));
	if (existsSync(target) && readdirSync(target).length > 0) {
		throw new UserError(`${target} already exists and is not empty.`);
	}
	return target;
}

/**
 * The value from the command line, else the answer to `question`. An empty
 * value is asked about without a default, and stays empty when nothing is asked.
 */
async function givenOrAsked(
	given: string | undefined,
	question: string,
	fallback: string,
	prompter: Prompter,
): Promise<string> {
	if (given) return given;
	return prompter.ask(question, given ?? fallback);
}

/** The name and slug, each defaulting to what the other or the folder suggests. */
export async function resolveIdentity(
	given: Partial<ProjectIdentity>,
	folder: string,
	prompter: Prompter,
): Promise<ProjectIdentity> {
	const suggestedName = displayName(given.slug ?? slugify(folder));
	const name = await givenOrAsked(given.name, "Project name", suggestedName, prompter);
	const slug = await givenOrAsked(given.slug, "Package slug", slugify(name), prompter);
	if (!slug) {
		throw new UserError("Could not derive a slug from the name. Pass --slug <kebab-case>.");
	}
	validateIdentity(name, slug);
	return { name: name.trim(), slug };
}

/** Whether to set up the Login App: what was passed, else the answer (no by default). */
export async function resolveLoginChoice(
	choice: boolean | undefined,
	prompter: Prompter,
): Promise<boolean> {
	if (choice !== undefined) return choice;
	return prompter.confirm(LOGIN_QUESTION, false);
}
