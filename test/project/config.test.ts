import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findProjectRoot, readProjectConfig } from "../../src/project/config";
import { UserError } from "../../src/system/errors";
import { tempDir, write } from "../helpers";

describe("project root", () => {
	test("is found from a nested folder", () => {
		const root = tempDir();
		write(root, ".vern/config.json", JSON.stringify({ project: { name: "Acme", slug: "acme" } }));
		write(root, "apps/web/src/index.ts", "");
		expect(findProjectRoot(join(root, "apps/web/src"))).toBe(root);
		expect(readProjectConfig(root)).toEqual({ name: "Acme", slug: "acme" });
	});

	test("is not found outside a project", () => {
		expect(findProjectRoot(tempDir())).toBeUndefined();
	});

	test("an unreadable config is an error", () => {
		const root = tempDir();
		write(root, ".vern/config.json", "{ nope");
		expect(() => readProjectConfig(root)).toThrow(UserError);
	});

	test("a config without a name and a slug is an error", () => {
		const root = tempDir();
		expect(() => readProjectConfig(root)).toThrow(UserError);
		write(root, ".vern/config.json", "null");
		expect(() => readProjectConfig(root)).toThrow(UserError);
		write(root, ".vern/config.json", JSON.stringify({ project: { name: "Acme", slug: "" } }));
		expect(() => readProjectConfig(root)).toThrow(UserError);
	});
});
