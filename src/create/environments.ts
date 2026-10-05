import { UserError } from "../system/errors";
import type { Logger, Prompter } from "../system/io";
import { stream } from "../system/process";

/** The environments that run the whole product, in the order they are asked about. */
export const ENVIRONMENTS = ["prod", "staging", "local"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** How an environment runs; `none` when the project has no such environment. */
export type Choice = "none" | "compose" | "kubernetes";
export type Environments = Record<Environment, Choice>;

const CHOICES: Record<Environment, Choice[]> = {
	prod: ["compose", "kubernetes"],
	staging: ["none", "compose", "kubernetes"],
	local: ["none", "compose", "kubernetes"],
};

/** What Enter answers: one server with Docker for production, and nothing else yet. */
const DEFAULTS: Environments = { prod: "compose", staging: "none", local: "none" };

/** Keep both ways, and choose in the project later. */
const LATER = "later";

const QUESTIONS: Record<Environment, string> = {
	prod: `How does production run? compose (Docker Compose on one server), kubernetes, or ${LATER} (keep both ways and choose in the project)`,
	staging: "How does staging run? none, compose, or kubernetes",
	local: "How does a rehearsal of production on your machine run? none, compose, or kubernetes (a kind cluster)",
};

function list(choices: string[]): string {
	return choices.join(", ").replace(/, ([^,]+)$/, ", or $1");
}

function check(environment: Environment, value: string): Choice {
	if (!CHOICES[environment].includes(value as Choice)) {
		throw new UserError(`--${environment} takes ${list(CHOICES[environment])}.`);
	}
	return value as Choice;
}

/** The answer to one question, asked again until it is one of `allowed`. */
async function askChoice(prompter: Prompter, question: string, allowed: string[], fallback: string): Promise<string> {
	for (;;) {
		const answer = (await prompter.ask(question, fallback)).trim().toLowerCase();
		if (allowed.includes(answer)) return answer;
	}
}

/**
 * How each environment runs: what was passed, else the answers. Nothing when
 * the project keeps both ways: no flag and nobody to ask, or the answer "later".
 */
export async function resolveEnvironments(
	given: Partial<Record<Environment, string>>,
	prompter: Prompter,
): Promise<Environments | undefined> {
	const chosen: Partial<Environments> = {};
	for (const environment of ENVIRONMENTS) {
		const value = given[environment];
		if (value !== undefined) chosen[environment] = check(environment, value);
	}
	const named = ENVIRONMENTS.filter((environment) => chosen[environment] !== undefined);
	if (!prompter.interactive) {
		if (named.length === 0) return undefined;
		if (named.length < ENVIRONMENTS.length) {
			throw new UserError("Pass --prod, --staging, and --local together, or none of them to keep both ways.");
		}
		return chosen as Environments;
	}
	for (const environment of ENVIRONMENTS) {
		if (chosen[environment] !== undefined) continue;
		// Only the first question offers to put the choice off.
		const allowed = named.length === 0 && environment === "prod" ? [...CHOICES.prod, LATER] : CHOICES[environment];
		const answer = await askChoice(prompter, QUESTIONS[environment], allowed, DEFAULTS[environment]);
		if (answer === LATER) return undefined;
		chosen[environment] = answer as Choice;
	}
	return chosen as Environments;
}

/**
 * Run the template's command (`stack`) that records the choice and removes
 * what no environment uses. False, with a warning, for a release of Vern from
 * before it had one: the project then keeps both ways.
 */
export function applyEnvironments(
	stage: string,
	bun: string,
	stack: string[] | undefined,
	environments: Environments,
	logger: Logger,
): boolean {
	if (!stack) {
		logger.warn(
			"This release of Vern cannot choose how the environments run yet, so the project keeps both ways. After an update, run `bun run project:stack` in it.",
		);
		return false;
	}
	logger.log(`Keeping what the environments use (${ENVIRONMENTS.map((name) => `${name}: ${environments[name]}`).join(", ")})`);
	const args = ENVIRONMENTS.flatMap((environment) => [`--${environment}`, environments[environment]]);
	if (stream(bun, [...stack, ...args], { cwd: stage }) !== 0) {
		throw new UserError("Choosing the environments failed, so no project was created.");
	}
	return true;
}
