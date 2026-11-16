/**
 * @jest-environment node
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("@/lib/platform/connectors/scanner/enrich-workspace", () => ({
	...jest.requireActual("@/lib/platform/connectors/scanner/enrich-workspace"),
	createEnrichWorkspace: jest.fn(),
}));

import { createEnrichWorkspace } from "@/lib/platform/connectors/scanner/enrich-workspace";
import {
	buildTrustablEnrichEnv,
	runTrustablEnrich,
} from "@/lib/platform/connectors/scanner/trustabl/enrich";
import {
	__resetScannerProcessRunnerForTests,
	setScannerProcessRunnerForTests,
	type ScannerProcessRunInput,
} from "@/lib/platform/connectors/scanner/process";
import type {
	ScannerEnrichRequest,
	ScannerEnrichRun,
	ScannerFinding,
} from "@/lib/platform/connectors/scanner/types";
import {
	SCANNER_ENRICH_NOT_DETECTED,
	SCANNER_ENRICH_PATH_OUTSIDE,
	SCANNER_ENRICH_STILL_DETECTED,
	SCANNER_ENRICH_TIMED_OUT,
} from "@/constants/messages/en";

const FIXTURES = join(__dirname, "../../../fixtures/trustabl-enrich");
const SCAN = JSON.parse(readFileSync(join(FIXTURES, "scan.json"), "utf8"));
const APPLIED = JSON.parse(readFileSync(join(FIXTURES, "enrich-applied.json"), "utf8"));
const ORIGINAL = readFileSync(join(FIXTURES, "agent.py"), "utf8");
const SHA = "826b268f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f";

const finding: ScannerFinding = {
	id: "finding-2",
	ruleId: "CSDK-101",
	severity: "high",
	category: "claude_sdk",
	scope: "agent",
	toolName: "data-analyst",
	path: "agent/agent.py",
	line: 4,
	endLine: 9,
	title: "Claude subagent is granted the Bash tool",
};

type EnrichMode = "fix" | "noop" | "provider-error" | "echo-key" | "not-applied" | "hang";

let root: string;
let calls: ScannerProcessRunInput[];
let modes: EnrichMode[];

/** Stand-in for the Trustabl CLI: scans by file content, enriches per mode. */
function fakeTrustabl(input: ScannerProcessRunInput) {
	calls.push(input);
	const repo = join(input.cwd || "", "repo");
	const file = join(repo, "agent", "agent.py");
	if (input.argv[0] === "scan") {
		const flagged = readFileSync(file, "utf8").includes('"Bash"');
		const findings = SCAN.findings.filter((row: { rule_id: string }) => flagged || row.rule_id !== "CSDK-101");
		return Promise.resolve({ exitCode: 1, stdout: JSON.stringify({ ...SCAN, findings }), stderr: "skipped rule: X\n" });
	}
	const mode = modes.shift() || "fix";
	if (mode === "hang") {
		// Like execFile: an already-aborted signal rejects at once.
		return new Promise<never>((_resolve, reject) => {
			const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
			if (input.signal?.aborted) abort();
			input.signal?.addEventListener("abort", abort);
		});
	}
	const row = { ...SCAN.findings.find((item: { rule_id: string }) => item.rule_id === "CSDK-101") };
	if (mode === "provider-error") {
		return Promise.resolve({
			exitCode: 0,
			stdout: JSON.stringify({ findings: [{ ...row, enriched: false }] }),
			stderr: 'enriching 1/1 findings (grouped by file)\nwarn: llm enrich agent/agent.py: claude api: 401 Unauthorized key sk-ant-api03-secretsecret\n',
		});
	}
	if (mode === "echo-key") {
		const key = input.env.ANTHROPIC_API_KEY;
		return Promise.resolve({
			exitCode: 0,
			stdout: JSON.stringify({ findings: [{ ...row, enriched: false }] }),
			stderr: `debug: using key ${key}\nwarn: llm enrich agent/agent.py: rejected key ${key}\n`,
		});
	}
	if (mode === "not-applied") {
		return Promise.resolve({
			exitCode: 0,
			stdout: JSON.stringify({ findings: [{ ...row, enriched: true, applied: false }] }),
			stderr: "enriching 1/1 findings (grouped by file)\n",
		});
	}
	writeFileSync(`${file}.trustabl.bak`, readFileSync(file));
	if (mode === "fix") writeFileSync(file, readFileSync(file, "utf8").replace('"Bash", ', ""));
	return Promise.resolve({
		exitCode: 0,
		stdout: JSON.stringify(APPLIED),
		stderr: "enriching 1/1 findings (grouped by file)\napplied 1 fix(es) to agent/agent.py\n",
	});
}

function request(overrides: Partial<ScannerEnrichRequest> = {}): ScannerEnrichRequest & { progress: Partial<ScannerEnrichRun>[] } {
	const progress: Partial<ScannerEnrichRun>[] = [];
	return {
		runId: "enrich:test",
		finding,
		alertNumber: 2,
		target: "https://github.com/acme/agents",
		params: { provider: "anthropic", attempts: 1, recheck: true, baseRef: "main" },
		providerKey: "sk-ant-test-key",
		signal: new AbortController().signal,
		onProgress: async (run) => {
			progress.push(JSON.parse(JSON.stringify(run)));
		},
		progress,
		...overrides,
	};
}

beforeEach(() => {
	calls = [];
	modes = [];
	root = mkdtempSync(join(tmpdir(), "openlit-enrich-test-"));
	mkdirSync(join(root, "repo", "agent"), { recursive: true });
	writeFileSync(join(root, "repo", "agent", "agent.py"), ORIGINAL);
	(createEnrichWorkspace as jest.Mock).mockResolvedValue({
		root,
		repoDir: join(root, "repo"),
		commitSha: SHA,
		ref: "main",
		durationMs: 2100,
	});
	setScannerProcessRunnerForTests({ run: fakeTrustabl });
});

afterEach(() => {
	__resetScannerProcessRunnerForTests();
	rmSync(root, { recursive: true, force: true });
	delete process.env.OPENAI_API_KEY;
});

const run = (req: ScannerEnrichRequest) => runTrustablEnrich(req, { bin: "/opt/trustabl" });

describe("runTrustablEnrich", () => {
	it("enriches, re-checks and returns the diff", async () => {
		const req = request();
		const result = await run(req);
		expect(result).toMatchObject({
			status: "succeeded",
			commitSha: SHA,
			attempt: 1,
			resolved: true,
			newFindings: 0,
			additions: 1,
			deletions: 1,
			explanation: "The data-analyst subagent lists Bash, so any delegated task can run shell commands.",
		});
		expect(result.diff).toContain('+        tools=["Glob", "Read", "Write"],');
		expect(result.steps?.map((step) => [step.key, step.status])).toEqual([
			["clone", "done"],
			["enrich", "done"],
			["recheck", "done"],
			["diff", "done"],
		]);
		expect(result.steps?.[0].detail).toBe("main @ 826b268");
		expect(result.log).toContain("$ trustabl enrich --input finding-2.json --repo repo --apply --diff");
		expect(result.log).toContain("enriching 1/1 findings (grouped by file)");
		expect(existsSync(root)).toBe(false);
	});

	it("runs scan and enrich in the working copy with relative paths", async () => {
		await run(request());
		expect(calls.map((call) => call.argv.slice(0, 2))).toEqual([
			["scan", "repo"],
			["enrich", "--input"],
			["scan", "repo"],
		]);
		expect(calls[0].argv).toEqual(expect.arrayContaining(["--format", "json", "--detectors", "claude_sdk"]));
		expect(calls.every((call) => call.cwd === root && call.bin === "/opt/trustabl")).toBe(true);
	});

	it("passes exactly one provider key and an isolated HOME", async () => {
		process.env.OPENAI_API_KEY = "sk-host-key-should-not-leak";
		await run(request({ params: { provider: "anthropic", model: "claude-sonnet-4-5", attempts: 1, recheck: true } }));
		const enrichCall = calls.find((call) => call.argv[0] === "enrich")!;
		expect(enrichCall.env.ANTHROPIC_API_KEY).toBe("sk-ant-test-key");
		expect(enrichCall.env.TRUSTABL_LLM_MODEL).toBe("claude-sonnet-4-5");
		expect(enrichCall.env.OPENAI_API_KEY).toBeUndefined();
		expect(enrichCall.env.GOOGLE_API_KEY).toBeUndefined();
		expect(enrichCall.env.HOME).toBe(join(root, "home"));
		const scanCall = calls.find((call) => call.argv[0] === "scan")!;
		expect(scanCall.env.ANTHROPIC_API_KEY).toBeUndefined();
	});

	it("skips the re-check when disabled", async () => {
		const result = await run(request({ params: { provider: "anthropic", attempts: 1, recheck: false } }));
		expect(result.status).toBe("succeeded");
		expect(result.resolved).toBeUndefined();
		expect(result.steps?.[2]).toMatchObject({ key: "recheck", status: "skipped" });
		expect(calls.filter((call) => call.argv[0] === "scan")).toHaveLength(1);
	});

	it("retries from the original file when the re-check still detects the finding", async () => {
		modes = ["noop", "fix"];
		const result = await run(request({ params: { provider: "anthropic", attempts: 2, recheck: true } }));
		expect(result).toMatchObject({ status: "succeeded", attempt: 2, resolved: true });
		expect(calls.filter((call) => call.argv[0] === "enrich")).toHaveLength(2);
	});

	it("fails with a partial diff when every attempt is still detected", async () => {
		modes = ["noop", "noop"];
		const result = await run(request({ params: { provider: "anthropic", attempts: 2, recheck: true } }));
		expect(result).toMatchObject({
			status: "failed",
			failure: "still-detected",
			attempt: 2,
			error: SCANNER_ENRICH_STILL_DETECTED("CSDK-101", 2),
		});
		expect(result.partialDiff).toContain("tools=");
		expect(result.explanation).toBe(APPLIED.findings[0].ai_explanation);
		expect(result.diff).toBeUndefined();
		expect(result.steps?.map((step) => step.status)).toEqual(["done", "done", "failed", "skipped"]);
		expect(result.steps?.[2].detail).toBe("still detected at agent/agent.py:4-9");
	});

	it("stops on a provider error without retrying", async () => {
		modes = ["provider-error"];
		const result = await run(request({ params: { provider: "anthropic", attempts: 2, recheck: true } }));
		expect(result).toMatchObject({ status: "failed", failure: "provider" });
		expect(result.error).toContain("401 Unauthorized");
		expect(JSON.stringify(result)).not.toContain("sk-ant-api03-secretsecret");
		expect(calls.filter((call) => call.argv[0] === "enrich")).toHaveLength(1);
	});

	it("redacts the provider key value from the log and error whatever its format", async () => {
		modes = ["echo-key"];
		const key = "proxy-key-0123456789abcdef";
		const req = request({ providerKey: key });
		const result = await run(req);
		expect(result).toMatchObject({ status: "failed", failure: "provider" });
		expect(result.error).toContain("rejected key");
		expect(JSON.stringify(result)).not.toContain(key);
		expect(JSON.stringify(req.progress)).not.toContain(key);
	});

	it("fails when no change could be applied", async () => {
		modes = ["not-applied"];
		const result = await run(request());
		expect(result).toMatchObject({ status: "failed", failure: "not-applied" });
	});

	it("fails when the finding is no longer detected", async () => {
		writeFileSync(join(root, "repo", "agent", "agent.py"), ORIGINAL.replace('"Bash", ', ""));
		const result = await run(request());
		expect(result).toMatchObject({
			status: "failed",
			failure: "not-found",
			error: SCANNER_ENRICH_NOT_DETECTED("main"),
		});
		expect(calls.some((call) => call.argv[0] === "enrich")).toBe(false);
	});

	it("refuses a finding whose file resolves outside the working copy", async () => {
		const outside = join(tmpdir(), `enrich-outside-${Date.now()}.py`);
		writeFileSync(outside, ORIGINAL);
		rmSync(join(root, "repo", "agent", "agent.py"));
		symlinkSync(outside, join(root, "repo", "agent", "agent.py"));
		try {
			const result = await run(request());
			expect(result).toMatchObject({ status: "failed", failure: "error", error: SCANNER_ENRICH_PATH_OUTSIDE });
			expect(calls.some((call) => call.argv[0] === "enrich")).toBe(false);
			expect(readFileSync(outside, "utf8")).toBe(ORIGINAL);
		} finally {
			rmSync(outside, { force: true });
		}
	});

	it("reports a cancelled run and removes the working copy", async () => {
		modes = ["hang"];
		const controller = new AbortController();
		const req = request({ signal: controller.signal });
		const pending = run(req);
		while (!calls.some((call) => call.argv[0] === "enrich")) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		controller.abort();
		const result = await pending;
		expect(result.status).toBe("cancelled");
		expect(existsSync(root)).toBe(false);
	});

	it("shows the enrich command in the log while the CLI runs", async () => {
		modes = ["hang"];
		const controller = new AbortController();
		const req = request({ signal: controller.signal });
		const pending = run(req);
		while (!calls.some((call) => call.argv[0] === "enrich")) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		expect(req.progress.at(-1)?.log).toEqual(
			expect.arrayContaining(["$ trustabl enrich --input finding-2.json --repo repo --apply --diff"])
		);
		controller.abort();
		await pending;
	});

	it("reports a run stopped by the timeout as failed", async () => {
		modes = ["hang"];
		const controller = new AbortController();
		const pending = run(request({ signal: controller.signal }));
		while (!calls.some((call) => call.argv[0] === "enrich")) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		controller.abort(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
		await expect(pending).resolves.toMatchObject({
			status: "failed",
			failure: "error",
			error: SCANNER_ENRICH_TIMED_OUT,
		});
	});

	it("reports a clone failure on the clone step", async () => {
		(createEnrichWorkspace as jest.Mock).mockRejectedValueOnce(new Error("GitHub returned HTTP 502"));
		const result = await run(request());
		expect(result).toMatchObject({ status: "failed", failure: "clone", error: "GitHub returned HTTP 502" });
		expect(result.steps?.[0].status).toBe("failed");
	});

	it("reports progress step by step", async () => {
		const req = request();
		await run(req);
		const running = req.progress.map((snapshot) => snapshot.steps?.find((step) => step.status === "running")?.key);
		expect(running.filter(Boolean)).toEqual(expect.arrayContaining(["clone", "enrich", "recheck"]));
		expect(running.indexOf("enrich")).toBeLessThan(running.indexOf("recheck"));
	});
});

describe("buildTrustablEnrichEnv", () => {
	it("omits the model when the Trustabl default is used", () => {
		const env = buildTrustablEnrichEnv({ home: "/tmp/h", provider: "google", key: "AIza-test" });
		expect(env.GOOGLE_API_KEY).toBe("AIza-test");
		expect(env.TRUSTABL_LLM_MODEL).toBeUndefined();
		expect(env.NO_COLOR).toBe("1");
	});
});
