import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProject } from "../../src/create/create-project";
import { updateCommand, updateProject } from "../../src/update/update-project";
import { createOptions, fakeCli, isolateGit, makeTemplate, recordingIo, tempDir } from "../helpers";

isolateGit();

describe("updateProject", () => {
	test("runs the newest CLI on npm, whatever the project has installed", () => {
		expect(updateCommand()).toEqual(["x", "@vern/cli@latest", "project:update"]);
	});

	test("runs the update from the project root, with the flags it was given", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "upd");
		await createProject(createOptions(target, { templateUrl: template.url }), recordingIo());
		// A nested folder resolves to the project root.
		const status = updateProject(["--apply"], join(target, "scripts"), fakeCli());
		expect(status).toBe(0);
		expect(readFileSync(join(target, "update-ran.txt"), "utf8")).toBe("project:update --apply");
	});

	test("says so when run outside a project", () => {
		expect(() => updateProject([], tempDir())).toThrow(/No .*config.json found/);
	});
});
