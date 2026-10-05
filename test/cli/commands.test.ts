import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { type CliContext, run } from "../../src/cli/commands";
import type { Io } from "../../src/system/io";
import { fakeCli, isolateGit, makeTemplate, readConfig, recordingIo, tempDir } from "../helpers";

isolateGit();

/** A command line run in an empty folder, with nothing in the environment. */
function context(extra: Partial<Omit<CliContext, "io">> = {}, io: Partial<Io> = {}) {
	return { cwd: tempDir(), env: {}, ...extra, io: recordingIo(io) };
}

describe("run", () => {
	test("prints the help and the version", async () => {
		const help = context();
		expect(await run(["--help"], help)).toBe(0);
		expect(help.io.lines.join("\n")).toContain("create-vern [directory] [options]");

		const version = context();
		expect(await run(["-v"], version)).toBe(0);
		expect(version.io.lines).toEqual([pkg.version]);
	});

	test("refuses flags that contradict each other", async () => {
		await expect(run(["app", "--with-login", "--no-login"], context())).rejects.toThrow(
			/either --with-login or --no-login/,
		);
		await expect(run(["update", "--apply", "--continue"], context())).rejects.toThrow(
			/either --apply or --continue/,
		);
	});

	test("refuses arguments it does not know", async () => {
		await expect(run(["app", "extra"], context())).rejects.toThrow(/Unexpected argument: extra/);
		await expect(run(["update", "extra"], context())).rejects.toThrow(/Unexpected argument: extra/);
		await expect(run(["app", "--nope"], context())).rejects.toThrow(/--nope/);
	});

	test("creates a project in the working directory, from the template in the environment", async () => {
		const template = makeTemplate();
		const cli = context({ env: { CREATE_VERN_TEMPLATE_URL: template.url } });
		const status = await run(["acme", "--name", "Acme Co.", "--ref", "v0.2.0", "--no-install", "-y"], cli);
		expect(status).toBe(0);
		const target = join(cli.cwd, "acme");
		expect(readConfig(target).project).toEqual({ name: "Acme Co.", slug: "acme-co" });
		expect(existsSync(join(target, "CHANGELOG.md"))).toBe(false);
		expect(cli.io.lines.join("\n")).toContain("  proto install && bun install");
	});

	test("asks about the login unless --no-login is passed", async () => {
		const template = makeTemplate();
		const asked: string[] = [];
		const terminal: Partial<Io> = {
			interactive: true,
			confirm: async (question: string) => {
				asked.push(question);
				return false;
			},
		};
		const env = { CREATE_VERN_TEMPLATE_URL: template.url };

		await run(["first", "--no-install"], context({ env }, terminal));
		expect(asked).toHaveLength(1);

		await run(["second", "--no-install", "--no-login"], context({ env }, terminal));
		expect(asked).toHaveLength(1);
	});

	test("passes the update mode to the CLI's update", async () => {
		const template = makeTemplate();
		const cli = context({ env: { CREATE_VERN_TEMPLATE_URL: template.url, CREATE_VERN_CLI: fakeCli() } });
		await run(["acme", "--no-install", "-y"], cli);
		const project = { ...cli, cwd: join(cli.cwd, "acme") };
		const ran = () => readFileSync(join(project.cwd, "update-ran.txt"), "utf8");

		expect(await run(["update"], project)).toBe(0);
		expect(ran()).toBe("project:update");
		expect(await run(["update", "--apply"], project)).toBe(0);
		expect(ran()).toBe("project:update --apply");
		expect(await run(["update", "--continue"], project)).toBe(0);
		expect(ran()).toBe("project:update --continue");
	});

	test("needs a project for update and login", async () => {
		await expect(run(["update"], context())).rejects.toThrow(/No .*config.json found/);
		await expect(run(["login"], context())).rejects.toThrow(/No .*config.json found/);
	});
});
