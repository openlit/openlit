import {
	sanitizeScannerArgv,
	sanitizeScannerBinary,
} from "@/lib/platform/connectors/scanner/process";
import { SCANNER_PROCESS_REJECTED } from "@/constants/messages/en";

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
