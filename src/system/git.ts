import { UserError } from "./errors";
import { capture } from "./process";

/** Who commits are made as. */
export interface CommitAuthor {
	/** True when Git has no user.name/user.email, so commits are made as create-vern. */
	fallback: boolean;
	/** `-c` flags that go before `commit`. */
	args: string[];
}

const FALLBACK_AUTHOR_ARGS = [
	"-c",
	"user.name=create-vern",
	"-c",
	"user.email=create-vern@users.noreply.github.com",
];

export function git(cwd: string, args: string[], what: string): string {
	const result = capture("git", args, { cwd });
	if (result.status !== 0) {
		const detail = result.stderr.trim() || `git ${args[0]} exited with ${result.status}`;
		throw new UserError(`${what} failed: ${detail}`);
	}
	return result.stdout.trim();
}

function isConfigured(cwd: string, key: string): boolean {
	return capture("git", ["config", key], { cwd }).stdout.trim() !== "";
}

/**
 * The author Git has configured for the repository in `cwd`, or create-vern
 * when it has none, so a fresh machine can still create the project. Ask after
 * the repository exists: before that, Git answers for any repository around it.
 */
export function resolveCommitAuthor(cwd: string): CommitAuthor {
	if (isConfigured(cwd, "user.name") && isConfigured(cwd, "user.email")) {
		return { fallback: false, args: [] };
	}
	return { fallback: true, args: FALLBACK_AUTHOR_ARGS };
}

/** Start a repository on `main`, also with a Git too old for `init -b`. */
export function initRepository(cwd: string): void {
	if (capture("git", ["init", "--quiet", "-b", "main"], { cwd }).status === 0) return;
	git(cwd, ["init", "--quiet"], "Creating the repository");
	git(cwd, ["symbolic-ref", "HEAD", "refs/heads/main"], "Naming the branch");
}

export function commitAll(cwd: string, message: string, author: CommitAuthor): void {
	git(cwd, ["add", "-A"], "Staging files");
	git(cwd, [...author.args, "commit", "--quiet", "-m", message], "Committing");
}
