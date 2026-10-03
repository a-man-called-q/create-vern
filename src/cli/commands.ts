import { createProject } from "../create/create-project";
import { setupLogin } from "../login/setup-login";
import { readProjectConfig, requireProjectRoot } from "../project/config";
import { UserError } from "../system/errors";
import type { Io } from "../system/io";
import { updateProject } from "../update/update-project";
import { type Flags, HELP, parseFlags, VERSION } from "./flags";

/** What a command reads from the process, handed in so nothing below reaches for it. */
export interface CliContext {
	cwd: string;
	env: NodeJS.ProcessEnv;
	io: Io;
}

/** Runs with the arguments after its name and returns the exit code. */
type Command = (flags: Flags, args: string[], context: CliContext) => number | Promise<number>;

function rejectExtra(args: string[]): void {
	const [extra] = args;
	if (extra !== undefined) throw new UserError(`Unexpected argument: ${extra}`);
}

/** `--with-login` or `--no-login`, else nothing: the question is asked. */
function loginChoice(flags: Flags): boolean | undefined {
	if (flags["with-login"]) return true;
	if (flags["no-login"]) return false;
	return undefined;
}

/** The flags the project's update script takes. */
function updateFlags(flags: Flags): string[] {
	if (flags.apply && flags.continue) {
		throw new UserError("Use either --apply or --continue.");
	}
	if (flags.apply) return ["--apply"];
	if (flags.continue) return ["--continue"];
	return [];
}

async function runCreate(flags: Flags, args: string[], context: CliContext): Promise<number> {
	const [dir, ...extra] = args;
	rejectExtra(extra);
	await createProject(
		{
			cwd: context.cwd,
			dir,
			name: flags.name,
			slug: flags.slug,
			ref: flags.ref,
			environments: { prod: flags.prod, staging: flags.staging, local: flags.local },
			login: loginChoice(flags),
			buildLogin: !flags["no-build"],
			install: !flags["no-install"],
			yes: Boolean(flags.yes),
			templateUrl: context.env.CREATE_VERN_TEMPLATE_URL,
		},
		context.io,
	);
	return 0;
}

function runUpdate(flags: Flags, args: string[], context: CliContext): number {
	rejectExtra(args);
	return updateProject(updateFlags(flags), context.cwd);
}

function runLogin(flags: Flags, _args: string[], context: CliContext): number {
	const root = requireProjectRoot(context.cwd);
	const { slug } = readProjectConfig(root);
	setupLogin(root, slug, { build: !flags["no-build"], cwd: context.cwd }, context.io);
	return 0;
}

/** The named commands; anything else is a directory for `runCreate`. */
const COMMANDS = new Map<string, Command>([
	["update", runUpdate],
	["login", runLogin],
]);

/** Run the command line and return the exit code. */
export async function run(argv: string[], context: CliContext): Promise<number> {
	const { values: flags, positionals } = parseFlags(argv);
	if (flags.help) {
		context.io.log(HELP);
		return 0;
	}
	if (flags.version) {
		context.io.log(VERSION);
		return 0;
	}
	if (flags["with-login"] && flags["no-login"]) {
		throw new UserError("Use either --with-login or --no-login.");
	}

	const [name = "", ...rest] = positionals;
	const command = COMMANDS.get(name);
	if (command) return command(flags, rest, context);
	return runCreate(flags, positionals, context);
}
