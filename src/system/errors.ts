/** An error whose message is meant for the person running the CLI. */
export class UserError extends Error {}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
