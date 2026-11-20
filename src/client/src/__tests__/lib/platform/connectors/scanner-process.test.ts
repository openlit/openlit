jest.mock("node:child_process", () => ({ execFile: jest.fn() }));

import { execFile } from "node:child_process";
import {
	defaultScannerProcessRunner,
	sanitizeScannerArgv,
	sanitizeScannerBinary,
} from "@/lib/platform/connectors/scanner/process";
import { SCANNER_PROCESS_REJECTED } from "@/constants/messages/en";

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

function mockExecFile(respond: (callback: ExecCallback) => void) {
	(execFile as unknown as jest.Mock).mockImplementation(
		(_command: string, _argv: string[], _options: unknown, callback: ExecCallback) => {
			respond(callback);
			return {};
		}
	);
}

describe("default scanner process runner", () => {
	beforeEach(() => jest.clearAllMocks());

	it("forwards the abort signal to the child process", async () => {
		const controller = new AbortController();
		mockExecFile((callback) => callback(null, "{}", ""));
		await defaultScannerProcessRunner.run({
			bin: "trustabl",
			argv: ["version"],
			env: {} as NodeJS.ProcessEnv,
			timeoutMs: 1000,
			signal: controller.signal,
		});
		expect((execFile as unknown as jest.Mock).mock.calls[0][2]).toEqual(
			expect.objectContaining({ signal: controller.signal })
		);
	});

	it("rejects with an AbortError when the run is aborted", async () => {
		mockExecFile((callback) =>
			callback(
				Object.assign(new Error("The operation was aborted"), {
					name: "AbortError",
					code: "ABORT_ERR",
				}),
				"",
				""
			)
		);
		await expect(
			defaultScannerProcessRunner.run({ bin: "trustabl", argv: ["version"], env: {} as NodeJS.ProcessEnv, timeoutMs: 1000 })
		).rejects.toMatchObject({ name: "AbortError" });
	});
});

describe("scanner process sanitization", () => {
	it("allows the Trustabl binary by name or absolute path", () => {
		expect(sanitizeScannerBinary("trustabl")).toBe("trustabl");
		expect(sanitizeScannerBinary("/opt/openlit/trustabl").endsWith("/trustabl")).toBe(true);
	});

	it("rejects other binaries and relative paths", () => {
		expect(() => sanitizeScannerBinary("bash")).toThrow(SCANNER_PROCESS_REJECTED);
		expect(() => sanitizeScannerBinary("../trustabl")).toThrow(SCANNER_PROCESS_REJECTED);
		expect(() => sanitizeScannerBinary("/tmp/trustabl;id")).toThrow(SCANNER_PROCESS_REJECTED);
	});

	it("allows scan argv built by OpenLIT", () => {
		expect(
			sanitizeScannerArgv([
				"scan",
				"https://github.com/acme/checkout-agent",
				"--format",
				"json",
				"--no-progress",
				"--rules-source",
				"production",
			])
		).toContain("scan");
	});

	it("rejects shell metacharacters in argv", () => {
		expect(() => sanitizeScannerArgv(["scan", "$(id)"])).toThrow(SCANNER_PROCESS_REJECTED);
		expect(() => sanitizeScannerArgv(["--output=/etc/passwd"])).toThrow(SCANNER_PROCESS_REJECTED);
	});
});
