import { describe, expect, test } from "bun:test";
import { displayName, slugify, validateIdentity } from "../../src/create/identity";
import { UserError } from "../../src/system/errors";

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
