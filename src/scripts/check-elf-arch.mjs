// Fail when a copied binary cannot run in this image.
// OpenLIT 1.24–2.1.0 arm64 images contained x86-64 otelcontribcol and
// opampsupervisor (e_machine 0x3e), so nothing listened on 4317/4318.
// https://github.com/openlit/openlit/issues/1747

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ELF_MACHINE = {
	x64: 62, // EM_X86_64
	arm64: 183, // EM_AARCH64
};

export function elfMachine(buf) {
	if (buf.length < 20 || buf[0] !== 0x7f || buf.toString("ascii", 1, 4) !== "ELF") {
		throw new Error("not an ELF binary");
	}
	return buf.readUInt16LE(18);
}

export function assertBinaryArch(path, arch = process.arch) {
	const expected = ELF_MACHINE[arch];
	if (!expected) {
		throw new Error(`unsupported runtime arch ${arch}`);
	}
	const machine = elfMachine(readFileSync(path));
	if (machine !== expected) {
		throw new Error(
			`${path} is e_machine ${machine} but this image is ${arch} (expected ${expected})`,
		);
	}
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	const bins = process.argv.slice(2);
	if (bins.length === 0) {
		console.error("usage: check-elf-arch.mjs <binary>...");
		process.exit(1);
	}
	for (const bin of bins) {
		assertBinaryArch(bin);
		console.log(`${bin} matches ${process.arch}`);
	}
}
