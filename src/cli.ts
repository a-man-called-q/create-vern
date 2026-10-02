#!/usr/bin/env node
import { run } from "./cli/commands";
import { errorMessage } from "./system/errors";
import { createIo } from "./system/io";

run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, io: createIo() }).then(
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		console.error(`create-vern: ${errorMessage(error)}`);
		process.exitCode = 1;
	},
);
