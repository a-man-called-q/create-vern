import { describe, expect, test } from "bun:test";
import { pickLatestTag } from "../../src/create/template";

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
