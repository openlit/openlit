type Row = {
	id: string;
	category: string;
	type: string;
	name: string;
	environment: string;
	organisationId: string;
	projectId: string;
	settings: string;
	secretRef: string | null;
	status: string;
	metadata: string;
	createdAt: Date;
	updatedAt: Date;
};

const rows = new Map<string, Row>();
const mockGetCurrentProjectForOrganisation = jest.fn();
const mockAdapter = {
	type: "trustabl",
	capabilities: () => ({ install: true, scan: true, listFindings: true, forge: true }),
	healthCheck: jest.fn(),
	ensureRuntime: jest.fn(),
	scan: jest.fn(),
	forge: jest.fn(),
	checkForge: jest.fn(),
};

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
	return Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
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
				const next = { ...(rows.get(where.id) as Row), ...data };
				rows.set(where.id, next);
				return next;
			}),
		},
	},
}));

jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: jest.fn(async () => ({ id: "org-1" })),
	getCurrentProjectForOrganisation: (...a: unknown[]) => mockGetCurrentProjectForOrganisation(...a),
}));

jest.mock("@/lib/project-environment", () => ({ createProjectEnvironment: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => ({ get: () => null })) }));
jest.mock("@/lib/access/connector-entitlement", () => ({ assertPremiumConnectorAllowed: jest.fn() }));
jest.mock("@/lib/platform/connectors/scanner/bootstrap", () => ({
	ensureScannerAdaptersRegistered: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/scanner/registry", () => ({
	hasScannerAdapterFactory: jest.fn(() => true),
	getScannerTypeDescriptor: jest.fn(() => ({
		type: "trustabl",
		capabilities: { install: true, scan: true, listFindings: true, forge: true },
	})),
	createScannerAdapter: jest.fn(() => mockAdapter),
	listScannerTypeDescriptors: jest.fn(() => []),
}));
jest.mock("@/lib/platform/connectors/scanner/runtime", () => ({
	probeTrustablRuntime: jest.fn(async () => ({
		installed: true,
		forge: { flags: [], policies: ["claude_sdk", "openai_sdk", "mcp", "claude_skill"] },
	})),
}));
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	invalidateSourceSecretCache: jest.fn(),
}));

import { listScannerConnectors } from "@/lib/platform/connectors/scanner/crud";
import {
	checkScannerForgeRun,
	getScannerForgeRun,
	runScannerForge,
} from "@/lib/platform/connectors/scanner/forge-crud";
import type { ScannerForgeAdapterInput, ScannerForgeRun } from "@/lib/platform/connectors/scanner/types";
import {
	SCANNER_CONNECTOR_NOT_FOUND,
	SCANNER_FORGE_POLICIES_REQUIRED,
	SCANNER_FORGE_RUN_ID_INVALID,
	SCANNER_FORGE_RUN_NO_CONTENT,
	SCANNER_FORGE_RUN_NOT_FOUND,
	SCANNER_FORGE_RUNNING,
} from "@/constants/messages/en";

const TARGET = "https://github.com/acme/agent";
const ANALYZER_JOB = {
	id: "job:scan1",
	status: "succeeded",
	target: TARGET,
	startedAt: "2026-11-09T10:45:45.000Z",
	report: { sdks: ["claude_agent_sdk"], mcpCount: 1 },
	findings: [],
};

function seed(metadata: Record<string, unknown> = { category: "scanner", jobs: [ANALYZER_JOB] }) {
	rows.set("scanner:abc", {
		id: "scanner:abc",
		category: "scanner",
		type: "trustabl",
		name: "Prod scan",
		environment: "production",
		organisationId: "org-1",
		projectId: "proj-1",
		settings: JSON.stringify({ target: TARGET }),
		secretRef: null,
		status: "active",
		metadata: JSON.stringify(metadata),
		createdAt: new Date(),
		updatedAt: new Date(),
	});
}

function stored(): Record<string, unknown> {
	return JSON.parse((rows.get("scanner:abc") as Row).metadata);
}

function succeeded(input: ScannerForgeAdapterInput): ScannerForgeRun {
	return {
		id: "forge:adapter",
		status: "succeeded",
		target: input.target,
		policies: input.policies,
		policySource: input.policySource,
		fileName: input.fileName,
		startedAt: new Date().toISOString(),
		content: "# Trustabl",
		summary: {
			ruleCount: 1,
			severityCounts: { critical: 0, high: 1, medium: 0, low: 0 },
			sections: [],
			lineCount: 1,
			byteLength: 10,
		},
	};
}

beforeEach(() => {
	rows.clear();
	jest.clearAllMocks();
	mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
	mockAdapter.forge.mockImplementation(async (input: ScannerForgeAdapterInput) => succeeded(input));
});

describe("runScannerForge", () => {
	it("prefills policies from the latest Analyzer scan and stores the run", async () => {
		seed();
		const result = await runScannerForge("scanner:abc", {});
		const input = mockAdapter.forge.mock.calls[0][0] as ScannerForgeAdapterInput;
		expect(input).toMatchObject({
			target: TARGET,
			policies: ["claude_sdk", "mcp"],
			fileName: "SKILL.md",
			policySource: { kind: "analyzer", jobId: "job:scan1", scannedAt: ANALYZER_JOB.startedAt },
		});
		expect(result.run.status).toBe("succeeded");
		expect(result.run.id).toMatch(/^forge:/);
		expect(result.run).not.toHaveProperty("content");
		const runs = stored().forgeRuns as ScannerForgeRun[];
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ id: result.run.id, content: "# Trustabl" });
		expect(stored().jobs).toHaveLength(1);
	});

	it("keeps explicit policies and records the scan they came from", async () => {
		seed();
		await runScannerForge("scanner:abc", {
			policies: ["openai_sdk"],
			sourceJobId: "job:scan1",
			fileName: "pre-coding.md",
			rulesRef: "v1",
		});
		expect(mockAdapter.forge.mock.calls[0][0]).toMatchObject({
			policies: ["openai_sdk"],
			fileName: "pre-coding.md",
			rulesRef: "v1",
			policySource: { kind: "analyzer", jobId: "job:scan1" },
		});
	});

	it("marks explicit policies without a known scan as manual", async () => {
		seed({ jobs: [] });
		await runScannerForge("scanner:abc", { policies: ["mcp"], sourceJobId: "job:missing" });
		expect(mockAdapter.forge.mock.calls[0][0].policySource).toEqual({ kind: "manual" });
	});

	it("requires policies when there is no Analyzer scan", async () => {
		seed({ jobs: [] });
		await expect(runScannerForge("scanner:abc", {})).rejects.toThrow(SCANNER_FORGE_POLICIES_REQUIRED);
		expect(mockAdapter.forge).not.toHaveBeenCalled();
		expect(stored().forgeRuns).toBeUndefined();
	});

	it("refuses a second forge while one is running", async () => {
		seed({
			jobs: [],
			forgeRuns: [
				{
					id: "forge:busy",
					status: "running",
					target: TARGET,
					policies: ["mcp"],
					policySource: { kind: "manual" },
					fileName: "SKILL.md",
					startedAt: new Date().toISOString(),
				},
			],
		});
		await expect(runScannerForge("scanner:abc", { policies: ["mcp"] })).rejects.toThrow(
			SCANNER_FORGE_RUNNING
		);
	});

	it("records a failed run when the adapter throws", async () => {
		seed();
		mockAdapter.forge.mockRejectedValue(new Error("boom"));
		await expect(runScannerForge("scanner:abc", {})).rejects.toThrow("boom");
		const runs = stored().forgeRuns as ScannerForgeRun[];
		expect(runs[0]).toMatchObject({ status: "failed", error: "boom" });
	});

	it("does not reach connectors in another project", async () => {
		seed();
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-2" });
		await expect(runScannerForge("scanner:abc", {})).rejects.toThrow(SCANNER_CONNECTOR_NOT_FOUND);
	});
});

describe("forge run reads", () => {
	beforeEach(() => {
		seed({
			jobs: [],
			forgeRuns: [
				{ ...succeeded({ target: TARGET, policies: ["mcp"], fileName: "SKILL.md", policySource: { kind: "manual" } }), id: "forge:ok", rulesRef: "v1" },
				{
					id: "forge:failed",
					status: "failed",
					target: TARGET,
					policies: ["mcp"],
					policySource: { kind: "manual" },
					fileName: "SKILL.md",
					startedAt: new Date().toISOString(),
					error: "bad",
				},
			],
		});
	});

	it("lists connectors with forge summaries but no content", async () => {
		const [connector] = await listScannerConnectors("production");
		expect(connector.forgeRuns.map((item) => item.id)).toEqual(["forge:ok", "forge:failed"]);
		expect(connector.forgeRuns[0]).not.toHaveProperty("content");
		expect(connector.metadata).not.toContain("forgeRuns");
		expect(connector.capabilities?.forge).toBe(true);
	});

	it("lists connectors without forge history", async () => {
		seed({ jobs: [] });
		const [connector] = await listScannerConnectors("production");
		expect(connector.forgeRuns).toEqual([]);
	});

	it("returns one run with its content", async () => {
		await expect(getScannerForgeRun("scanner:abc", "forge:ok")).resolves.toMatchObject({
			id: "forge:ok",
			content: "# Trustabl",
		});
		await expect(getScannerForgeRun("scanner:abc", "forge:nope")).rejects.toThrow(
			SCANNER_FORGE_RUN_NOT_FOUND
		);
		await expect(getScannerForgeRun("scanner:abc", "../etc")).rejects.toThrow(
			SCANNER_FORGE_RUN_ID_INVALID
		);
	});

	it("checks a run against the current rules", async () => {
		mockAdapter.checkForge.mockResolvedValue({ status: "stale", message: "outdated", checkedAt: "now" });
		await expect(checkScannerForgeRun("scanner:abc", "forge:ok")).resolves.toMatchObject({
			status: "stale",
		});
		expect(mockAdapter.checkForge).toHaveBeenCalledWith("# Trustabl", "v1");
		await expect(checkScannerForgeRun("scanner:abc", "forge:failed")).rejects.toThrow(
			SCANNER_FORGE_RUN_NO_CONTENT
		);
	});
});
