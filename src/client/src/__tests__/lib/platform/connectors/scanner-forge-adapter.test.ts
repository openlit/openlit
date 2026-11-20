import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrustablAdapter, trustablAdapterFactory } from "@/lib/platform/connectors/scanner/trustabl/adapter";
import {
	__resetScannerProcessRunnerForTests,
	setScannerProcessRunnerForTests,
	type ScannerProcessRunInput,
} from "@/lib/platform/connectors/scanner/process";
import { probeTrustablRuntime } from "@/lib/platform/connectors/scanner/runtime";
import type { ScannerForgeAdapterInput } from "@/lib/platform/connectors/scanner/types";
import {
	SCANNER_FORGE_EMPTY_OUTPUT,
	SCANNER_FORGE_OUTPUT_TOO_LARGE,
	SCANNER_FORGE_POLICY_UNKNOWN,
	SCANNER_FORGE_UNSUPPORTED,
	SCANNER_RUNTIME_NOT_INSTALLED,
} from "@/constants/messages/en";

const SKILL = readFileSync(join(__dirname, "../../../fixtures/trustabl/forge-skill.md"), "utf8");
const POLICIES = ["claude_sdk", "mcp", "claude_skill"];

jest.mock("@/lib/platform/connectors/scanner/runtime", () => ({
	TRUSTABL_PINNED_VERSION: "v0.1.8",
	probeTrustablRuntime: jest.fn(),
	resolveTrustablBinary: jest.fn(async () => ({ bin: "/opt/trustabl", source: "cache" })),
	scannerCliVersionLabel: (runtime: { binaryVersion?: string; version?: string }) =>
		runtime.binaryVersion || runtime.version,
}));

jest.mock("@/lib/platform/connectors/scanner/install", () => ({
	describeTrustablRuntime: jest.fn(),
	installTrustablCli: jest.fn(),
}));

jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn(async () => ({ raw: "", credentials: { githubToken: "ghp_secret" } })),
}));

const installedRuntime = {
	installed: true,
	version: "trustabl 0.1.8",
	source: "cache",
	binaryVersion: "v0.1.8",
	forge: {
		version: "v0.1.8",
		policies: POLICIES,
		flags: [{ flag: "rules-ref", key: "rulesRef", kind: "string", group: "rules", help: "" }],
	},
};

function adapter() {
	return new TrustablAdapter({
		type: "trustabl",
		id: "scanner:1",
		name: "scan",
		environment: "production",
		settings: { target: "https://github.com/acme/agent" },
	});
}

function forgeInput(over: Partial<ScannerForgeAdapterInput> = {}): ScannerForgeAdapterInput {
	return {
		target: "https://github.com/acme/agent",
		policies: ["claude_sdk", "mcp"],
		fileName: "SKILL.md",
		policySource: { kind: "analyzer", jobId: "job:1", scannedAt: "2026-11-09T10:45:45.000Z" },
		...over,
	};
}

describe("Trustabl adapter forge", () => {
	beforeEach(() => {
		(probeTrustablRuntime as jest.Mock).mockResolvedValue(installedRuntime);
	});

	afterEach(() => {
		__resetScannerProcessRunnerForTests();
	});

	it("advertises the forge capability", () => {
		expect(trustablAdapterFactory.describe().capabilities.forge).toBe(true);
	});

	it("runs forge in an empty temp directory and reads SKILL.md from stdout", async () => {
		let seen: ScannerProcessRunInput | undefined;
		let cwdWasEmpty = false;
		setScannerProcessRunnerForTests({
			run: async (input) => {
				seen = input;
				cwdWasEmpty = readdirSync(String(input.cwd)).length === 0;
				return { exitCode: 0, stdout: SKILL, stderr: "" };
			},
		});
		const run = await adapter().forge(forgeInput());
		expect(seen?.argv).toEqual(["forge", "--policy", "claude_sdk,mcp"]);
		expect(seen?.cwd?.startsWith(tmpdir())).toBe(true);
		expect(cwdWasEmpty).toBe(true);
		expect(existsSync(String(seen?.cwd))).toBe(false);
		expect(seen?.env.GITHUB_TOKEN).toBeUndefined();
		expect(seen?.env.GH_TOKEN).toBeUndefined();
		expect(run).toMatchObject({
			status: "succeeded",
			target: "https://github.com/acme/agent",
			policies: ["claude_sdk", "mcp"],
			fileName: "SKILL.md",
			exitCode: 0,
			cliVersion: "v0.1.8",
			command: "trustabl forge --policy claude_sdk,mcp",
			policySource: { kind: "analyzer", jobId: "job:1" },
		});
		expect(run.id).toMatch(/^forge:[A-Za-z0-9_-]+$/);
		expect(run.content).toBe(SKILL);
		expect(run.summary?.ruleCount).toBe(75);
	});

	it("passes the rules ref when the CLI supports it", async () => {
		let argv: string[] = [];
		setScannerProcessRunnerForTests({
			run: async (input) => {
				argv = input.argv;
				return { exitCode: 0, stdout: SKILL, stderr: "" };
			},
		});
		await adapter().forge(forgeInput({ rulesRef: "v1" }));
		expect(argv).toEqual(["forge", "--policy", "claude_sdk,mcp", "--rules-ref", "v1"]);
	});

	it("rejects policies the installed CLI does not accept before running", async () => {
		const run = jest.fn();
		setScannerProcessRunnerForTests({ run });
		await expect(adapter().forge(forgeInput({ policies: ["nope"] }))).rejects.toThrow(
			SCANNER_FORGE_POLICY_UNKNOWN("nope")
		);
		expect(run).not.toHaveBeenCalled();
	});

	it("marks the run failed with the CLI error line", async () => {
		setScannerProcessRunnerForTests({
			run: async () => ({
				exitCode: 1,
				stdout: "",
				stderr: 'trustabl forge: unknown policy category "x"\nmore detail',
			}),
		});
		const run = await adapter().forge(forgeInput());
		expect(run.status).toBe("failed");
		expect(run.error).toBe('trustabl forge: unknown policy category "x"');
		expect(run.content).toBeUndefined();
	});

	it("fails on empty output", async () => {
		setScannerProcessRunnerForTests({ run: async () => ({ exitCode: 0, stdout: "  ", stderr: "" }) });
		const run = await adapter().forge(forgeInput());
		expect(run.status).toBe("failed");
		expect(run.error).toBe(SCANNER_FORGE_EMPTY_OUTPUT);
	});

	it("fails on output larger than 512 KB", async () => {
		setScannerProcessRunnerForTests({
			run: async () => ({ exitCode: 0, stdout: "x".repeat(512 * 1024 + 1), stderr: "" }),
		});
		const run = await adapter().forge(forgeInput());
		expect(run.status).toBe("failed");
		expect(run.error).toBe(SCANNER_FORGE_OUTPUT_TOO_LARGE);
	});

	it("reports a missing runtime", async () => {
		(probeTrustablRuntime as jest.Mock).mockResolvedValue({ installed: false });
		const run = await adapter().forge(forgeInput());
		expect(run.status).toBe("runtime-missing");
		expect(run.error).toBe(SCANNER_RUNTIME_NOT_INSTALLED);
	});

	it("fails when the installed CLI has no forge command", async () => {
		(probeTrustablRuntime as jest.Mock).mockResolvedValue({ ...installedRuntime, forge: undefined });
		const run = await adapter().forge(forgeInput());
		expect(run.status).toBe("failed");
		expect(run.error).toBe(SCANNER_FORGE_UNSUPPORTED);
	});
});

describe("Trustabl adapter forge check", () => {
	beforeEach(() => {
		(probeTrustablRuntime as jest.Mock).mockResolvedValue(installedRuntime);
	});

	afterEach(() => {
		__resetScannerProcessRunnerForTests();
	});

	it("writes SKILL.md to a temp directory and runs forge check on it", async () => {
		let seen: ScannerProcessRunInput | undefined;
		let written = "";
		setScannerProcessRunnerForTests({
			run: async (input) => {
				seen = input;
				written = readFileSync(join(String(input.cwd), "SKILL.md"), "utf8");
				return {
					exitCode: 1,
					stdout: "outdated: generated from 0000000, current rules are 9eca09d\n",
					stderr: "",
				};
			},
		});
		const check = await adapter().checkForge(SKILL, "v1");
		expect(seen?.argv).toEqual(["forge", "check", "SKILL.md", "--rules-ref", "v1"]);
		expect(written).toBe(SKILL);
		expect(existsSync(String(seen?.cwd))).toBe(false);
		expect(check).toMatchObject({
			status: "stale",
			message: "outdated: generated from 0000000, current rules are 9eca09d",
		});
	});

	it("reports an error when the CLI is missing", async () => {
		(probeTrustablRuntime as jest.Mock).mockResolvedValue({ installed: false });
		const check = await adapter().checkForge(SKILL);
		expect(check).toMatchObject({ status: "error", message: SCANNER_RUNTIME_NOT_INSTALLED });
	});
});
