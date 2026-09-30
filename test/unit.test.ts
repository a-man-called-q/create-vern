import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { displayName, slugify, validateIdentity } from "../src/create";
import { setEnvValue } from "../src/login";
import { UserError } from "../src/system";
import { pickLatestTag } from "../src/template";
import { findProjectRoot, readProjectConfig } from "../src/update";
import { tempDir, write } from "./helpers";

describe("identity", () => {
	test("derives a slug and a display name from a folder name", () => {
		expect(slugify("My Cool_App")).toBe("my-cool-app");
		expect(slugify("--acme--")).toBe("acme");
		expect(displayName("acme-platform")).toBe("Acme Platform");
	});

	test("rejects what the template's rename would reject", () => {
		expect(() => validateIdentity("Acme Platform", "acme-platform")).not.toThrow();
		expect(() => validateIdentity("Acme!", "acme")).toThrow(UserError);
		expect(() => validateIdentity("Acme", "Acme")).toThrow(UserError);
		expect(() => validateIdentity("Acme", "acme_platform")).toThrow(UserError);
	});
});

describe("pickLatestTag", () => {
	const listing = (...tags: string[]) =>
		tags.map((tag) => `abc123\trefs/tags/${tag}`).join("\n");

	test("compares releases numerically", () => {
		expect(pickLatestTag(listing("v0.2.0", "v0.10.0", "v0.9.5"))).toBe("v0.10.0");
	});

	test("ignores prereleases and other tags", () => {
		expect(pickLatestTag(listing("v1.0.0", "v2.0.0-beta.1", "nightly"))).toBe("v1.0.0");
	});

	test("returns nothing when there are no releases", () => {
		expect(pickLatestTag("")).toBeUndefined();
		expect(pickLatestTag(listing("nightly"))).toBeUndefined();
	});
});

describe("setEnvValue", () => {
	test("replaces an existing value, keeping the other lines", () => {
		expect(setEnvValue("A=1\nB=2\nC=3\n", "B", "x=y")).toBe("A=1\nB=x=y\nC=3\n");
	});

	test("appends a missing key", () => {
		expect(setEnvValue("A=1", "B", "2")).toBe("A=1\nB=2\n");
		expect(setEnvValue("", "B", "2")).toBe("B=2\n");
	});

	test("does not treat replacement text as a pattern", () => {
		expect(setEnvValue("A=1\n", "A", "$&$1")).toBe("A=$&$1\n");
	});
});

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
});
