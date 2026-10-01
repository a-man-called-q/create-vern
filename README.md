# create-vern

Create a [Vern](https://github.com/a-man-called-q/vern) project, and keep it up
to date. Vern is a template for web apps and APIs that sign in through a local
[ZITADEL](https://zitadel.com).

```sh
bunx create-vern my-app        # or: npx create-vern my-app, pnpm dlx create-vern my-app
```

It asks for a project name and slug (taken from the folder name by default), then:

1. Copies the latest Vern release into a staging folder, without Vern's history.
2. Renames Vern to your name and slug there.
3. Moves the result to `my-app/` as a new Git repository with one commit, so the
   project starts out already named. If any step fails, nothing is left behind.
4. Installs the toolchain (`proto install`) and dependencies (`bun install`).

Then follow the printed steps: generate an app, run `bun run setup`, and start
`moon run :dev`.

## Requirements

- **Git.**
- **Docker, later.** Creating the project does not touch Docker, even when other
  Vern checkouts have containers or volumes on the machine. `bun run setup` and the
  login image (`--with-login`) need it running.
- **[proto](https://moonrepo.dev/docs/proto/install)** for the toolchain pinned in
  the template (Bun, Moon, Rust). When Bun is missing, create-vern installs the
  pinned one with proto.

Node.js 20 or later is enough to run `npx create-vern`; the project itself runs on Bun.

## Options

```
create-vern [directory] [options]

--name <name>     Display name (default: from the directory)
--slug <slug>     Package slug, lowercase kebab-case (default: from the name)
--ref <ref>       Template tag, branch, or commit on main (default: latest release)
--with-login      Also copy vern-zitadel-login next to the project
--no-login        Skip the login question
--no-build        With the login: do not build its image
--no-install      Skip `proto install` and `bun install`
-y, --yes         Take defaults instead of asking
```

Without a terminal (CI, pipes) nothing is asked: pass the directory, and it uses
the defaults for everything else.

## Update

Inside a project created with create-vern:

```sh
npx create-vern update             # preview what changed in Vern
npx create-vern update --apply     # review branch: merge, upgrade dependencies, validate
npx create-vern update --continue  # resume after resolving conflicts
```

This runs the project's own `scripts/update-project.ts`, so the update logic always
matches the template the project came from. The baseline it merges from is the
commit create-vern copied, recorded in `.vern/config.json`.

## Customize the login page

Colors, logo, text, and images of the sign-in page need no extra repository: use
ZITADEL's branding settings and `apps/auth-server/brand/`. Changing the layout
means editing the Login App source, which lives in
[vern-zitadel-login](https://github.com/a-man-called-q/vern-zitadel-login). Choose
that when create-vern asks, pass `--with-login`, or run this later:

```sh
npx create-vern login
```

It copies the Login App to `<slug>-login/` next to the project, builds
`<slug>-login:local`, and points `apps/auth-server/.env` at that image and its
ZITADEL version. The project keeps working with the published image if any of
those steps fails.

The copy is yours: it keeps the Login App's history, which the ZITADEL sync
workflow merges new releases onto, and has no remote. To deploy it, push it to a
repository of your own, tags included:

```sh
git remote add origin <your repository>
git push -u origin main --tags
```

## Develop

```sh
bun install
bun test
bun run typecheck
bun run build      # dist/cli.js, a Node-compatible bundle with no dependencies
```

`CREATE_VERN_TEMPLATE_URL` points the installer at another copy of the template;
the tests use it with a local fixture. The rename records the upstream that
`scripts/rename-project.ts` names, so use it for testing only.

Windows is untested.

## License

[MIT](LICENSE)
