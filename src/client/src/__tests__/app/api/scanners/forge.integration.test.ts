/**
 * Forge end to end through the API routes, scanner crud, the Trustabl
 * adapter, and runtime introspection. Only Prisma, the session, and the CLI
 * process are faked.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Row = Record<string, unknown> & { id: string; metadata: string };

const rows = new Map<string, Row>();
const mockProjectId = { current: "proj-1" };

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
	return Object.entries(where).every(([key, value]) => row[key] === value);
}

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		connectorInstance: {
			findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
				Array.from(rows.values()).find((row) => matches(row, where)) || null
			),
			findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
				Array.from(rows.values()).filter((row) => matches(row, where))
			),
			update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
				const next = { ...(rows.get(where.id) as Row), ...data } as Row;
				rows.set(where.id, next);
				return next;
			}),
		},
	},
}));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(async () => ({ id: "user-1" })) }));
jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: jest.fn(async () => ({ id: "org-1" })),
	getCurrentProjectForOrganisation: jest.fn(async () => ({ id: mockProjectId.current })),
}));
jest.mock("@/lib/project-environment", () => ({ createProjectEnvironment: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => ({ get: () => null })) }));
jest.mock("@/lib/access/connector-entitlement", () => ({ assertPremiumConnectorAllowed: jest.fn() }));
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	invalidateSourceSecretCache: jest.fn(),
	resolveSourceSecret: jest.fn(async () => ({ raw: "", credentials: {} })),
}));

import { GET as GETScanners } from "@/app/api/scanners/route";
import { POST as POSTForge } from "@/app/api/scanners/[id]/forge/route";
import { GET as GETRun } from "@/app/api/scanners/[id]/forge/[runId]/route";
import { GET as GETCheck } from "@/app/api/scanners/[id]/forge/[runId]/check/route";
import {
	__resetScannerProcessRunnerForTests,
	setScannerProcessRunnerForTests,
	type ScannerProcessRunInput,
} from "@/lib/platform/connectors/scanner/process";
import { __resetScannerCliSchemaCacheForTests } from "@/lib/platform/connectors/scanner/runtime";
import { SCANNER_CONNECTOR_NOT_FOUND, SCANNER_FORGE_RUNNING } from "@/constants/messages/en";

const FIXTURES = join(__dirname, "../../../fixtures/trustabl");
const SKILL = readFileSync(join(FIXTURES, "forge-skill.md"), "utf8");
const FORGE_HELP = readFileSync(join(FIXTURES, "forge-help.txt"), "utf8");
const TARGET = "https://github.com/anthropics/claude-agent-sdk-demos";

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

function fakeTrustabl(calls: ScannerProcessRunInput[]) {
	setScannerProcessRunnerForTests({
		run: async (input) => {
			calls.push(input);
			const command = input.argv.join(" ");
			if (command === "version") return { exitCode: 0, stdout: "Trustabl 0.1.8\n", stderr: "" };
			if (command === "scan --help") {
				return { exitCode: 0, stdout: "Flags:\n      --strict   fail on low+\n", stderr: "" };
			}
			if (command === "forge --help") return { exitCode: 0, stdout: FORGE_HELP, stderr: "" };
			if (command === "forge") {
				return {
					exitCode: 1,
					stdout: "",
					stderr: "accepted categories: [claude_sdk openai_sdk mcp claude_skill]\n",
				};
			}
			if (command.startsWith("forge check")) {
				return {
					exitCode: 1,
					stdout: "outdated: generated from 9eca09d, current rules are 3f9c1e2\n",
					stderr: "",
				};
			}
			if (command.startsWith("forge --policy")) return { exitCode: 0, stdout: SKILL, stderr: "" };
			return { exitCode: 2, stdout: "", stderr: `unexpected ${command}` };
		},
	});
}

function post(body: unknown) {
	return { text: async () => JSON.stringify(body) } as any;
}

describe("Trustabl Forge API integration", () => {
	const previousBin = process.env.TRUSTABL_BIN;
	const previousCache = process.env.OPENLIT_RUNTIME_CACHE;
	let root: string;
	let calls: ScannerProcessRunInput[];

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "openlit-forge-it-"));
		writeFileSync(join(root, "trustabl"), "");
		process.env.TRUSTABL_BIN = join(root, "trustabl");
		process.env.OPENLIT_RUNTIME_CACHE = join(root, "cache");
		__resetScannerCliSchemaCacheForTests();
		mockProjectId.current = "proj-1";
		calls = [];
		fakeTrustabl(calls);
		rows.clear();
		rows.set("scanner:abc", {
			id: "scanner:abc",
			category: "scanner",
			type: "trustabl",
			name: "Agent SDK demos",
			environment: "production",
			organisationId: "org-1",
			projectId: "proj-1",
			settings: JSON.stringify({ target: TARGET }),
			secretRef: null,
			status: "active",
			metadata: JSON.stringify({
				category: "scanner",
				jobs: [
					{
						id: "job:scan1",
						status: "succeeded",
						target: TARGET,
						startedAt: "2026-11-09T10:45:45.000Z",
						report: { sdks: ["claude_agent_sdk"], mcpCount: 1 },
						findings: [],
					},
				],
			}),
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	});

	afterEach(() => {
		__resetScannerProcessRunnerForTests();
		process.env.TRUSTABL_BIN = previousBin;
		process.env.OPENLIT_RUNTIME_CACHE = previousCache;
		rmSync(root, { recursive: true, force: true });
	});

	it("forges, lists, reads, and checks a skill", async () => {
		const created = await POSTForge(post({}), { params: { id: "scanner:abc" } });
		expect(created.status).toBe(200);
		const { run } = await created.json();
		expect(run).toMatchObject({
			status: "succeeded",
			policies: ["claude_sdk", "mcp"],
			policySource: { kind: "analyzer", jobId: "job:scan1" },
			command: "trustabl forge --policy claude_sdk,mcp",
		});
		expect(run.summary.ruleCount).toBe(75);
		expect(run.content).toBeUndefined();
		const forgeCall = calls.find((call) => call.argv[1] === "--policy");
		expect(forgeCall?.cwd?.startsWith(tmpdir())).toBe(true);

		const listed = await (await GETScanners({} as any)).json();
		const connector = listed.connectors[0];
		expect(connector.forgeRuns[0].id).toBe(run.id);
		expect(connector.forgeRuns[0].content).toBeUndefined();
		expect(connector.capabilities.forge).toBe(true);
		expect(JSON.stringify(listed)).not.toContain("Trustabl Pre-Coding");

		const detail = await (await GETRun({} as any, { params: { id: "scanner:abc", runId: run.id } })).json();
		expect(detail.run.content).toBe(SKILL);

		const check = await (await GETCheck({} as any, { params: { id: "scanner:abc", runId: run.id } })).json();
		expect(check.check).toMatchObject({
			status: "stale",
			message: "outdated: generated from 9eca09d, current rules are 3f9c1e2",
		});
	});

	it("refuses a concurrent forge", async () => {
		const row = rows.get("scanner:abc") as Row;
		const metadata = JSON.parse(row.metadata);
		metadata.forgeRuns = [
			{
				id: "forge:busy",
				status: "running",
				target: TARGET,
				policies: ["mcp"],
				policySource: { kind: "manual" },
				fileName: "SKILL.md",
				startedAt: new Date().toISOString(),
			},
		];
		rows.set(row.id, { ...row, metadata: JSON.stringify(metadata) });
		const response = await POSTForge(post({ policies: ["mcp"] }), { params: { id: "scanner:abc" } });
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(SCANNER_FORGE_RUNNING);
	});

	it("does not reach a connector from another project", async () => {
		mockProjectId.current = "proj-2";
		const response = await POSTForge(post({}), { params: { id: "scanner:abc" } });
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(SCANNER_CONNECTOR_NOT_FOUND);
		expect(calls.some((call) => call.argv[0] === "forge" && call.argv[1] === "--policy")).toBe(false);
	});
});
