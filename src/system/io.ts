import { createInterface } from "node:readline/promises";

export interface Logger {
	log(message: string): void;
	warn(message: string): void;
}

export interface Prompter {
	/** False when stdin or stdout is not a terminal; prompts then use defaults. */
	interactive: boolean;
	ask(question: string, fallback: string): Promise<string>;
	confirm(question: string, fallback: boolean): Promise<boolean>;
}

export interface Io extends Logger, Prompter {}

/** Asks nothing and takes every default, as `--yes` does. */
export const acceptDefaults: Prompter = {
	interactive: false,
	ask: async (_question, fallback) => fallback,
	confirm: async (_question, fallback) => fallback,
};

export function createIo(): Io {
	const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

	async function ask(question: string, fallback: string): Promise<string> {
		if (!interactive) return fallback;
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		try {
			const suffix = fallback ? ` (${fallback})` : "";
			const answer = (await rl.question(`${question}${suffix}: `)).trim();
			return answer || fallback;
		} finally {
			rl.close();
		}
	}

	return {
		interactive,
		log: (message) => console.log(message),
		warn: (message) => console.warn(`! ${message}`),
		ask,
		async confirm(question, fallback) {
			if (!interactive) return fallback;
			const hint = fallback ? "Y/n" : "y/N";
			for (;;) {
				const answer = (await ask(`${question} [${hint}]`, "")).toLowerCase();
				if (!answer) return fallback;
				if (["y", "yes"].includes(answer)) return true;
				if (["n", "no"].includes(answer)) return false;
			}
		},
	};
}
