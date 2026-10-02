import { describe, expect, test } from "bun:test";
import { setEnvValue } from "../../src/system/env-file";

describe("setEnvValue", () => {
	test("replaces an existing value, keeping the other lines", () => {
		expect(setEnvValue("A=1\nB=2\nC=3\n", "B", "x=y")).toBe("A=1\nB=x=y\nC=3\n");
	});

	test("appends a missing key", () => {
		expect(setEnvValue("A=1", "B", "2")).toBe("A=1\nB=2\n");
		expect(setEnvValue("A=1\n", "B", "2")).toBe("A=1\nB=2\n");
		expect(setEnvValue("", "B", "2")).toBe("B=2\n");
	});

	test("does not treat replacement text as a pattern", () => {
		expect(setEnvValue("A=1\n", "A", "$&$1")).toBe("A=$&$1\n");
	});
});
