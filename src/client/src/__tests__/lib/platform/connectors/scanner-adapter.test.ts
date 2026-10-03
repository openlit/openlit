import { TrustablAdapter } from "@/lib/platform/connectors/scanner/trustabl/adapter";
import {
	__resetScannerProcessRunnerForTests,
	setScannerProcessRunnerForTests,
} from "@/lib/platform/connectors/scanner/process";

jest.mock("@/lib/platform/connectors/scanner/runtime", () => ({
	TRUSTABL_PINNED_VERSION: "v0.1.8",
	probeTrustablRuntime: jest.fn(async () => ({
		installed: true,
		version: "trustabl 0.1.8",
		source: "cache",
		binaryVersion: "v0.1.8",
	})),
	resolveTrustablBinary: jest.fn(async () => ({ bin: "/opt/trustabl", source: "cache" })),
	scannerCliVersionLabel: (runtime: { binaryVersion?: string; version?: string }) =>
		runtime.binaryVersion || runtime.version,
}));

jest.mock("@/lib/platform/connectors/scanner/install", () => ({
	describeTrustablRuntime: jest.fn(async () => ({
		installed: true,
		version: "trustabl 0.1.8",
		source: "cache",
		binaryVersion: "v0.1.8",
		latestVersion: "v0.1.8",
		upgradeAvailable: false,
	})),
	installTrustablCli: jest.fn(async () => ({
		installed: true,
		version: "trustabl 0.1.8",
		source: "cache",
	})),
}));

jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn(async () => ({ raw: "", credentials: {} })),
}));

describe("Trustabl adapter", () => {
	afterEach(() => {
		__resetScannerProcessRunnerForTests();
	});

	it("scans through the process runner and parses findings", async () => {
		setScannerProcessRunnerForTests({
			run: async ({ argv }) => {
				expect(argv).toEqual([
					"scan",
					"https://github.com/acme/checkout-agent",
					"--format",
					"json",
					"--no-progress",
					"--no-color",
					"--rules-source",
					"production",
				]);
				return {
					exitCode: 1,
					stdout: JSON.stringify({
						scan_id: "abc",
						overall_score: 0.72,
						findings: [
							{ rule_id: "MCP-004", severity: "medium", path: "src/mcp/server.ts", title: "Unsandboxed tool" },
						],
					}),
					stderr: "",
				};
			},
		});
		const adapter = new TrustablAdapter({
			type: "trustabl",
			id: "scanner:1",
			name: "scan",
			environment: "production",
			settings: { target: "https://github.com/acme/checkout-agent", requireSigned: false },
		});
		const job = await adapter.scan();
		expect(job.status).toBe("succeeded");
		expect(job.exitCode).toBe(1);
		expect(job.findings?.[0].ruleId).toBe("MCP-004");
		expect(job.report?.scanId).toBe("abc");
		expect(job.report?.overallScore).toBe(0.72);
		expect(job.params?.rulesSource).toBe("production");
		expect(job.params?.requireSigned).toBe(false);
		expect(job.cliVersion).toBe("v0.1.8");
	});

	it("lets per-run flags override connector defaults", async () => {
		setScannerProcessRunnerForTests({
			run: async ({ argv }) => {
				expect(argv).toEqual([
					"scan",
					"https://github.com/acme/checkout-agent",
					"--format",
					"json",
					"--no-progress",
					"--no-color",
					"--detectors",
					"mcp",
					"--strict",
					"--secret-scan",
					"--vuln-scan",
					"--license-scan",
					"--rules-repo",
					"https://github.com/acme/rules",
					"--rules-ref",
					"v1",
					"--rules-source",
					"staging",
					"--require-signed",
					"--no-rules-update",
					"--verbose",
				]);
				return { exitCode: 0, stdout: "{}", stderr: "" };
			},
		});
		const adapter = new TrustablAdapter({
			type: "trustabl",
			id: "scanner:1",
			name: "scan",
			environment: "production",
			settings: {
				target: "https://github.com/acme/checkout-agent",
				ref: "main",
				detectors: "claude_sdk",
				strict: false,
				requireSigned: false,
			},
		});
		const job = await adapter.scan({
			ref: "develop",
			detectors: "mcp",
			strict: true,
			secretScan: true,
			vulnScan: true,
			licenseScan: true,
			requireSigned: true,
			rulesRepo: "https://github.com/acme/rules",
			rulesRef: "v1",
			rulesSource: "staging",
			noRulesUpdate: true,
			verbose: true,
		});
		expect(job.status).toBe("succeeded");
		expect(job.ref).toBe("develop");
		expect(job.params?.detectors).toBe("mcp");
	});

	it("treats exit code 2 as a scanner failure", async () => {
		setScannerProcessRunnerForTests({
			run: async () => ({
				exitCode: 2,
				stdout: "",
				stderr: "no usable rules",
			}),
		});
		const adapter = new TrustablAdapter({
			type: "trustabl",
			id: "scanner:1",
			name: "scan",
			settings: { target: "https://github.com/acme/checkout-agent" },
		});
		const job = await adapter.scan();
		expect(job.status).toBe("failed");
		expect(job.error).toMatch(/no usable rules/);
	});
});
