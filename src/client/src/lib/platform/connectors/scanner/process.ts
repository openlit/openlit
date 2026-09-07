import { execFile } from "node:child_process";

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

export const defaultScannerProcessRunner: ScannerProcessRunner = {
	run(input) {
		return new Promise((resolve, reject) => {
			execFile(
				input.bin,
				input.argv,
				{
					cwd: input.cwd,
					env: input.env,
					timeout: input.timeoutMs,
					maxBuffer: DEFAULT_MAX_BUFFER,
					windowsHide: true,
				},
				(error, stdout, stderr) => {
					const out = String(stdout || "");
					const err = String(stderr || "");
					if (!error) {
						resolve({ exitCode: 0, stdout: out, stderr: err });
						return;
					}
					const code =
						typeof (error as NodeJS.ErrnoException & { code?: string | number }).code ===
						"number"
							? Number((error as { code: number }).code)
							: (error as { status?: number }).status;
					if (typeof code === "number") {
						resolve({ exitCode: code, stdout: out, stderr: err });
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
