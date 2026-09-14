import { execFile } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { SCANNER_PROCESS_REJECTED } from "@/constants/messages/en";

export interface ScannerCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface ScannerProcessRunInput {
	bin: string;
	argv: string[];
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
	cwd?: string;
}

export interface ScannerProcessRunner {
	run(input: ScannerProcessRunInput): Promise<ScannerCommandResult>;
}

const DEFAULT_MAX_BUFFER = 20 * 1024 * 1024;
const TRUSTABL_BIN_NAMES = new Set(["trustabl", "trustabl.exe"]);
const SAFE_FLAG = /^--[a-z][a-z0-9-]{0,62}$/;
const SAFE_TOKEN = /^[A-Za-z0-9._/~+,=-]{1,200}$/;
const SAFE_HTTPS = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._/~+=%-]+$/;
const UNSAFE_META = /[\0\r\n;|&`$()<>\\]/;

export function sanitizeScannerBinary(bin: string): string {
	const trimmed = String(bin || "").trim();
	if (!trimmed || UNSAFE_META.test(trimmed) || trimmed.includes("..")) {
		throw new Error(SCANNER_PROCESS_REJECTED);
	}
	const name = basename(trimmed);
	if (!TRUSTABL_BIN_NAMES.has(name)) {
		throw new Error(SCANNER_PROCESS_REJECTED);
	}
	if (trimmed === name) return name;
	if (!isAbsolute(trimmed)) {
		throw new Error(SCANNER_PROCESS_REJECTED);
	}
	return join(dirname(resolve(trimmed)), name);
}

export function sanitizeScannerArgvToken(token: string): string {
	const value = String(token);
	if (!value || value.length > 500 || UNSAFE_META.test(value)) {
		throw new Error(SCANNER_PROCESS_REJECTED);
	}
	if (value.startsWith("--")) {
		if (!SAFE_FLAG.test(value)) throw new Error(SCANNER_PROCESS_REJECTED);
		return value;
	}
	if (SAFE_TOKEN.test(value) || SAFE_HTTPS.test(value)) return value;
	throw new Error(SCANNER_PROCESS_REJECTED);
}

export function sanitizeScannerArgv(argv: string[]): string[] {
	if (!Array.isArray(argv) || argv.length > 64) {
		throw new Error(SCANNER_PROCESS_REJECTED);
	}
	return argv.map(sanitizeScannerArgvToken);
}

function sanitizeScannerCwd(cwd?: string): string | undefined {
	if (cwd == null || cwd === "") return undefined;
	const resolved = resolve(cwd);
	if (!isAbsolute(resolved) || resolved.includes(`..${sep}`) || UNSAFE_META.test(resolved)) {
		throw new Error(SCANNER_PROCESS_REJECTED);
	}
	return resolved;
}

export const defaultScannerProcessRunner: ScannerProcessRunner = {
	run(input) {
		const bin = sanitizeScannerBinary(input.bin);
		const argv = sanitizeScannerArgv(input.argv);
		const cwd = sanitizeScannerCwd(input.cwd);
		return new Promise((resolvePromise, reject) => {
			execFile(
				bin,
				argv,
				{
					cwd,
					env: input.env,
					timeout: input.timeoutMs,
					maxBuffer: DEFAULT_MAX_BUFFER,
					windowsHide: true,
					shell: false,
				},
				(error, stdout, stderr) => {
					const out = String(stdout || "");
					const err = String(stderr || "");
					if (!error) {
						resolvePromise({ exitCode: 0, stdout: out, stderr: err });
						return;
					}
					const code =
						typeof (error as NodeJS.ErrnoException & { code?: string | number }).code ===
						"number"
							? Number((error as { code: number }).code)
							: (error as { status?: number }).status;
					if (typeof code === "number") {
						resolvePromise({ exitCode: code, stdout: out, stderr: err });
						return;
					}
					reject(error);
				}
			);
		});
	},
};

let processRunner: ScannerProcessRunner = defaultScannerProcessRunner;

export function getScannerProcessRunner(): ScannerProcessRunner {
	return processRunner;
}

export function setScannerProcessRunnerForTests(runner: ScannerProcessRunner): void {
	processRunner = runner;
}

export function __resetScannerProcessRunnerForTests(): void {
	processRunner = defaultScannerProcessRunner;
}
