import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProject } from "../../src/create/create-project";
import { updateProject } from "../../src/update/update-project";
import { createOptions, isolateGit, makeTemplate, recordingIo, tempDir } from "../helpers";

isolateGit();

describe("updateProject", () => {
	test("runs the project's own update script from the project root", async () => {
		const template = makeTemplate();
		const target = join(tempDir(), "upd");
		await createProject(createOptions(target, { templateUrl: template.url }), recordingIo());
		// A nested folder resolves to the project root, and the flags are passed through.
		const status = updateProject(["--apply"], join(target, "scripts"));
		expect(status).toBe(0);
		expect(readFileSync(join(target, "update-ran.txt"), "utf8")).toBe("--apply");
	});

	test("says so when run outside a project", () => {
		expect(() => updateProject([], tempDir())).toThrow(/No .*config.json found/);
	});
});
