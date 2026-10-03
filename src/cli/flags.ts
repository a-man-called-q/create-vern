import { parseArgs } from "node:util";
import pkg from "../../package.json" with { type: "json" };

export const VERSION = pkg.version;

export const HELP = `create-vern ${VERSION}

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
  --prod <how>      How production runs: compose (Docker Compose) or kubernetes
  --staging <how>   How staging runs: none, compose, or kubernetes
  --local <how>     How a rehearsal of production on this machine runs:
                    none, compose, or kubernetes
                    The project keeps only the files of what these use. Without
                    the three (and with --yes) it keeps both ways; choose later
                    with \`bun run project:stack\` in the project.
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

/** Every flag of every command; a new flag goes here and in `HELP`. */
export function parseFlags(argv: string[]) {
	return parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			name: { type: "string" },
			slug: { type: "string" },
			ref: { type: "string" },
			prod: { type: "string" },
			staging: { type: "string" },
			local: { type: "string" },
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
}

export type Flags = ReturnType<typeof parseFlags>["values"];
