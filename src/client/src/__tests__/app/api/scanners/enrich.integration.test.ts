/**
 * @jest-environment node
 *
 * Enrich end to end through the API routes: real crud, run persistence,
 * pipeline, GitHub tarball download and `tar` extraction. Only the database,
 * session, organisation, Vault, GitHub (fetch) and the Trustabl CLI are fakes.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Row = { id: string; projectId: string; category: string; type: string; name: string; settings: string; secretRef: string | null; environment: string; metadata: string };

const mockRows = new Map<string, Row>();
const mockProject = { id: "proj-1" };
const mockVault = new Map<string, string>();

function matches(row: Row, where: Record<string, unknown> = {}) {
	return Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
}

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		connectorInstance: {
			findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
				const row = Array.from(mockRows.values()).find((item) => matches(item, where));
				return row ? { ...row } : null;
			}),
			findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
				Array.from(mockRows.values()).filter((item) => matches(item, where))
			),
			update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
				const next = { ...(mockRows.get(where.id) as Row), ...data };
				mockRows.set(where.id, next);
				return next;
			}),
		},
	},
}));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(async () => ({ id: "user-1" })) }));
jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: jest.fn(async () => ({ id: "org-1" })),
	getCurrentProjectForOrganisation: jest.fn(async () => mockProject),
}));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => ({ get: () => null })) }));
jest.mock("@/lib/project-environment", () => ({ createProjectEnvironment: jest.fn() }));
jest.mock("@/lib/access/connector-entitlement", () => ({ assertPremiumConnectorAllowed: jest.fn() }));
jest.mock("@/lib/platform/vault", () => ({
	getSecretById: jest.fn(),
	getSecrets: jest.fn(async ({ key }: { key: string }, options: { selectValue?: boolean } = {}) => ({
		data: mockVault.has(key) ? [{ key, ...(options.selectValue ? { value: mockVault.get(key) } : {}) }] : [],
	})),
}));
jest.mock("@/lib/platform/connectors/scanner/runtime", () => ({
	...jest.requireActual("@/lib/platform/connectors/scanner/runtime"),
	probeTrustablRuntime: jest.fn(async () => ({ installed: true })),
	resolveTrustablBinary: jest.fn(async () => ({ bin: "trustabl" })),
}));
jest.mock("@/lib/platform/connectors/scanner/install", () => ({
	describeTrustablRuntime: jest.fn(),
	installTrustablCli: jest.fn(),
}));

import { GET as GETLatest, POST as POSTStart } from "@/app/api/scanners/[id]/enrich/route";
import { GET as GETProviders } from "@/app/api/scanners/[id]/enrich/providers/route";
import { DELETE, GET as GETRun } from "@/app/api/scanners/[id]/enrich/[runId]/route";
import { POST as POSTCancel } from "@/app/api/scanners/[id]/enrich/[runId]/cancel/route";
import { __resetScannerEnrichRegistryForTests } from "@/lib/platform/connectors/scanner/enrich-crud";
import {
	__resetScannerProcessRunnerForTests,
	setScannerProcessRunnerForTests,
	type ScannerProcessRunInput,
} from "@/lib/platform/connectors/scanner/process";
import type { ScannerEnrichRun, ScannerFinding, ScannerJob } from "@/lib/platform/connectors/scanner/types";
import {
	SCANNER_CONNECTOR_NOT_FOUND,
	SCANNER_ENRICH_KEY_MISSING,
	SCANNER_ENRICH_RUN_NOT_FOUND,
} from "@/constants/messages/en";

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

const FIXTURES = join(__dirname, "../../../fixtures/trustabl-enrich");
const SCAN = JSON.parse(readFileSync(join(FIXTURES, "scan.json"), "utf8"));
const APPLIED = JSON.parse(readFileSync(join(FIXTURES, "enrich-applied.json"), "utf8"));
const SHA = "826b268f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f";
const ID = "scanner:1";
const JOB_ID = "job:abee6854-450a-445d-98a9-8ed0076c05b7";
const PROVIDER_KEY = "sk-ant-integration-key-0123456789";
const REMOVED_LINE = '-        tools=["Glob", "Read", "Bash", "Write"],';

const findings: ScannerFinding[] = [
	{ id: "f1", ruleId: "META-005", severity: "info", title: "Rules skipped" },
	{
		id: "f2",
		ruleId: "CSDK-101",
		severity: "high",
		category: "claude_sdk",
		scope: "agent",
		toolName: "data-analyst",
		path: "agent/agent.py",
		line: 4,
		endLine: 9,
		title: "Claude subagent is granted the Bash tool",
	},
];
const job: ScannerJob = {
	id: JOB_ID,
	status: "succeeded",
	target: "https://github.com/acme/agents",
	startedAt: "2026-11-12T00:00:00.000Z",
	findings,
	params: { rulesSource: "production", detectors: "claude_sdk" },
};

type EnrichMode = "fix" | "provider-error" | "hang";

let fixtureDir: string;
let tarball: Buffer;
let modes: EnrichMode[];
let fetched: { url: string; headers: Record<string, string> }[];
let cliEnv: NodeJS.ProcessEnv[];

/** Stand-in for the Trustabl CLI: scans by file content, enriches per mode. */
function fakeTrustabl(input: ScannerProcessRunInput) {
	cliEnv.push(input.env || {});
	const file = join(input.cwd || "", "repo", "agent", "agent.py");
	if (input.argv[0] === "scan") {
		const flagged = readFileSync(file, "utf8").includes('"Bash"');
		const rows = SCAN.findings.filter((row: { rule_id: string }) => flagged || row.rule_id !== "CSDK-101");
		return Promise.resolve({ exitCode: 1, stdout: JSON.stringify({ ...SCAN, findings: rows }), stderr: "" });
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
	const row = SCAN.findings.find((item: { rule_id: string }) => item.rule_id === "CSDK-101");
	if (mode === "provider-error") {
		return Promise.resolve({
			exitCode: 0,
			stdout: JSON.stringify({ findings: [{ ...row, enriched: false }] }),
			stderr: `warn: llm enrich agent/agent.py: claude api: 401 Unauthorized key ${PROVIDER_KEY}\n`,
		});
	}
	writeFileSync(`${file}.trustabl.bak`, readFileSync(file));
	writeFileSync(file, readFileSync(file, "utf8").replace('"Bash", ', ""));
	return Promise.resolve({
		exitCode: 0,
		stdout: JSON.stringify(APPLIED),
		stderr: "enriching 1/1 findings (grouped by file)\napplied 1 fix(es) to agent/agent.py\n",
	});
}

// jest.setup installs a minimal Response polyfill, so build fetch responses by hand.
function fakeResponse(body: string | Buffer, status = 200) {
	const bytes = typeof body === "string" ? Buffer.from(body) : body;
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => null },
		text: async () => bytes.toString("utf8"),
		body: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(bytes));
				controller.close();
			},
		}),
	};
}

beforeAll(() => {
	fixtureDir = mkdtempSync(join(tmpdir(), "enrich-int-fixture-"));
	const top = join(fixtureDir, "acme-agents-826b268");
	mkdirSync(join(top, "agent"), { recursive: true });
	writeFileSync(join(top, "agent", "agent.py"), readFileSync(join(FIXTURES, "agent.py")));
	execFileSync("tar", ["-czf", join(fixtureDir, "repo.tar.gz"), "-C", fixtureDir, "acme-agents-826b268"]);
	tarball = readFileSync(join(fixtureDir, "repo.tar.gz"));
});

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

beforeEach(() => {
	__resetScannerEnrichRegistryForTests();
	modes = [];
	fetched = [];
	cliEnv = [];
	mockProject.id = "proj-1";
	mockVault.clear();
	mockVault.set("ANTHROPIC_API_KEY", PROVIDER_KEY);
	mockRows.clear();
	mockRows.set(ID, {
		id: ID,
		projectId: "proj-1",
		category: "scanner",
		type: "trustabl",
		name: "Trustabl",
		settings: JSON.stringify({ target: job.target }),
		secretRef: null,
		environment: "production",
		metadata: JSON.stringify({ category: "scanner", jobs: [job] }),
	});
	process.env.OPENLIT_GITHUB_API_URL = "http://github.test";
	global.fetch = jest.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
		fetched.push({ url, headers: init?.headers || {} });
		if (url === `http://github.test/repos/acme/agents/commits/HEAD`) return fakeResponse(SHA);
		if (url === `http://github.test/repos/acme/agents/tarball/${SHA}`) return fakeResponse(tarball);
		return fakeResponse("", 404);
	}) as unknown as typeof fetch;
	setScannerProcessRunnerForTests({ run: fakeTrustabl });
});

afterEach(() => {
	__resetScannerProcessRunnerForTests();
	delete process.env.OPENLIT_GITHUB_API_URL;
});

function postRequest(body: unknown) {
	return { text: async () => JSON.stringify(body) } as any;
}

function getRequest(path = "") {
	return { url: `http://localhost/api/scanners/${ID}/enrich${path}` } as Request;
}

async function start(): Promise<ScannerEnrichRun> {
	const response = await POSTStart(
		postRequest({ jobId: JOB_ID, alertNumber: 2, provider: "anthropic" }),
		{ params: { id: ID } }
	);
	expect(response.status).toBe(200);
	return (await response.json()).run;
}

async function poll(runId: string, done: (run: ScannerEnrichRun) => boolean): Promise<ScannerEnrichRun> {
	for (let index = 0; index < 500; index += 1) {
		const response = await GETRun(getRequest(), { params: { id: ID, runId } });
		const { run } = await response.json();
		if (done(run)) return run;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`run ${runId} did not settle`);
}

const finished = (run: ScannerEnrichRun) => run.status !== "running";

describe("enrich through the API", () => {
	it("lists providers with key presence only", async () => {
		const response = await GETProviders(getRequest("/providers"), { params: { id: ID } });
		const { providers } = await response.json();
		expect(providers.map((item: { id: string; hasKey: boolean }) => [item.id, item.hasKey])).toEqual([
			["anthropic", true],
			["openai", false],
			["google", false],
		]);
		expect(JSON.stringify(providers)).not.toContain(PROVIDER_KEY);
	});

	it("fixes the finding, re-checks it, and returns the diff", async () => {
		const started = await start();
		expect(started.status).toBe("running");
		const run = await poll(started.id, finished);
		expect(run).toMatchObject({ status: "succeeded", resolved: true, commitSha: SHA, attempt: 1 });
		expect(run.diff).toContain(REMOVED_LINE);
		expect(run.steps.map((step) => step.status)).toEqual(["done", "done", "done", "done"]);
		expect(fetched.map((call) => call.url)).toEqual([
			"http://github.test/repos/acme/agents/commits/HEAD",
			`http://github.test/repos/acme/agents/tarball/${SHA}`,
		]);
		expect(cliEnv.some((env) => env.ANTHROPIC_API_KEY === PROVIDER_KEY)).toBe(true);
		expect(mockRows.get(ID)!.metadata).not.toContain(PROVIDER_KEY);

		const latest = await GETLatest(getRequest(`?jobId=${JOB_ID}&alertNumber=2`), { params: { id: ID } });
		await expect(latest.json()).resolves.toMatchObject({ run: { id: run.id, status: "succeeded" } });
	});

	it("reports a provider error without leaking the key", async () => {
		modes = ["provider-error"];
		const run = await poll((await start()).id, finished);
		expect(run).toMatchObject({ status: "failed", failure: "provider" });
		expect(JSON.stringify(run)).not.toContain(PROVIDER_KEY);
		expect(mockRows.get(ID)!.metadata).not.toContain(PROVIDER_KEY);
	});

	it("cancels a run that is still enriching", async () => {
		modes = ["hang"];
		const started = await start();
		await poll(started.id, (run) => run.steps[1].status === "running");
		const response = await POSTCancel(postRequest({}), { params: { id: ID, runId: started.id } });
		expect(response.status).toBe(200);
		const run = await poll(started.id, finished);
		expect(run.status).toBe("cancelled");
	});

	it("needs the provider key in Vault", async () => {
		mockVault.clear();
		const response = await POSTStart(
			postRequest({ jobId: JOB_ID, alertNumber: 2, provider: "anthropic" }),
			{ params: { id: ID } }
		);
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(SCANNER_ENRICH_KEY_MISSING("ANTHROPIC_API_KEY"));
		expect(fetched).toEqual([]);
	});

	it("discards a finished run", async () => {
		const run = await poll((await start()).id, finished);
		const response = await DELETE(getRequest(), { params: { id: ID, runId: run.id } });
		await expect(response.json()).resolves.toEqual({ ok: true });
		const missing = await GETRun(getRequest(), { params: { id: ID, runId: run.id } });
		expect(missing.status).toBe(400);
		await expect(missing.json()).resolves.toBe(SCANNER_ENRICH_RUN_NOT_FOUND);
	});

	it("does not show a run to another project", async () => {
		const run = await poll((await start()).id, finished);
		mockProject.id = "proj-2";
		const response = await GETRun(getRequest(), { params: { id: ID, runId: run.id } });
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(SCANNER_CONNECTOR_NOT_FOUND);
	});
});
