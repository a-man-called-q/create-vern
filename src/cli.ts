#!/usr/bin/env node
import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { createProject } from "./create";
import { setupLogin } from "./login";
import { createIo } from "./prompt";
import { UserError } from "./system";
import { readProjectConfig, requireProjectRoot, updateProject } from "./update";

const HELP = `create-vern ${pkg.version}

Create a Vern project, and keep it up to date.

Usage:
  create-vern [directory] [options]   Create a project
  create-vern update [--apply | --continue]
                                      Preview, apply, or resume an update from Vern
  create-vern login [options]         Add the Login App source next to this project

Create options:
  --name <name>     Display name (default: from the directory)
  --slug <slug>     Package slug, lowercase kebab-case (default: from the name)
  --ref <ref>       Template tag, branch, or commit on main (default: latest release)
  --with-login      Also copy vern-zitadel-login next to the project
  --no-login        Skip the login question
  --no-build        With the login: do not build its image
  --no-install      Skip \`proto install\` and \`bun install\`
  -y, --yes         Take defaults instead of asking

  -h, --help        Show this help
  -v, --version     Show the version

Requires git. Bun is installed with proto when missing. Docker is needed later, by
\`bun run setup\` and by --with-login (to build the image), not to create the project.
`;

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			name: { type: "string" },
			slug: { type: "string" },
			ref: { type: "string" },
			"with-login": { type: "boolean" },
			"no-login": { type: "boolean" },
			"no-build": { type: "boolean" },
			"no-install": { type: "boolean" },
			apply: { type: "boolean" },
			continue: { type: "boolean" },
			yes: { type: "boolean", short: "y" },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
		},
	});

	if (values.help) {
		console.log(HELP);
		return 0;
	}
	if (values.version) {
		console.log(pkg.version);
		return 0;
	}
	if (values["with-login"] && values["no-login"]) {
		throw new UserError("Use either --with-login or --no-login.");
	}

	const [first, ...rest] = positionals;
	if (first === "update") {
		if (rest.length > 0) throw new UserError(`Unexpected argument: ${rest[0]}`);
		if (values.apply && values.continue) {
			throw new UserError("Use either --apply or --continue.");
		}
		const flags = [values.apply ? "--apply" : "", values.continue ? "--continue" : ""];
		return updateProject(flags.filter(Boolean), process.cwd());
	}

	const io = createIo();
	if (first === "login") {
		const root = requireProjectRoot(process.cwd());
		const { slug } = readProjectConfig(root);
		setupLogin(root, slug, { build: !values["no-build"] }, io);
		return 0;
	}

	if (rest.length > 0) throw new UserError(`Unexpected argument: ${rest[0]}`);
	await createProject(
		{
			dir: first,
			name: values.name,
			slug: values.slug,
			ref: values.ref,
			login: values["with-login"] ? true : values["no-login"] ? false : undefined,
			buildLogin: !values["no-build"],
			install: !values["no-install"],
			yes: Boolean(values.yes),
		},
		io,
	);
	return 0;
}

main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`create-vern: ${message}`);
		process.exitCode = 1;
	},
);
