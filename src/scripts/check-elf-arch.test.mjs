import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertBinaryArch, elfMachine } from "./check-elf-arch.mjs";

const script = fileURLToPath(new URL("./check-elf-arch.mjs", import.meta.url));

function fakeElf(machine) {
	const buf = Buffer.alloc(64);
	buf[0] = 0x7f;
	buf.write("ELF", 1, "ascii");
	buf.writeUInt16LE(machine, 18);
	return buf;
}

test("reads e_machine and rejects a foreign binary", () => {
	const dir = mkdtempSync(join(tmpdir(), "elf-"));
	try {
		const native = join(dir, "native");
		const foreign = join(dir, "foreign");
		const expected = process.arch === "arm64" ? 183 : 62;
		const other = expected === 183 ? 62 : 183;
		writeFileSync(native, fakeElf(expected));
		writeFileSync(foreign, fakeElf(other));
		assert.equal(elfMachine(fakeElf(expected)), expected);
		assert.doesNotThrow(() => assertBinaryArch(native));
		assert.throws(() => assertBinaryArch(foreign), /e_machine/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("cli exits non-zero for an amd64 binary on the other arch", () => {
	const dir = mkdtempSync(join(tmpdir(), "elf-cli-"));
	try {
		const bin = join(dir, "otelcontribcol");
		writeFileSync(bin, fakeElf(process.arch === "arm64" ? 62 : 183));
		const result = spawnSync(process.execPath, [script, bin], { encoding: "utf8" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /e_machine/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
