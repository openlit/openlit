/**
 * @jest-environment node
 */
type Row = { id: string; projectId: string; category: string; type: string; name: string; settings: string; secretRef: string | null; environment: string; metadata: string };

const mockRows = new Map<string, Row>();
const mockProject = { id: "proj-1" };
const mockEnrich = jest.fn();

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
jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: jest.fn(async () => ({ id: "org-1" })),
	getCurrentProjectForOrganisation: jest.fn(async () => mockProject),
}));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => ({ get: () => null })) }));
jest.mock("@/lib/project-environment", () => ({ createProjectEnvironment: jest.fn() }));
jest.mock("@/lib/access/connector-entitlement", () => ({ assertPremiumConnectorAllowed: jest.fn() }));
jest.mock("@/lib/platform/connectors/scanner/bootstrap", () => ({ ensureScannerAdaptersRegistered: jest.fn() }));
jest.mock("@/lib/platform/connectors/scanner/registry", () => ({
	hasScannerAdapterFactory: () => true,
	getScannerTypeDescriptor: () => ({}),
	listScannerTypeDescriptors: () => [],
	createScannerAdapter: () => ({
		type: "trustabl",
		capabilities: () => ({ install: true, scan: true, listFindings: true, enrich: true }),
		enrich: (...args: unknown[]) => mockEnrich(...args),
	}),
}));
jest.mock("@/lib/platform/connectors/scanner/runtime", () => ({
	probeTrustablRuntime: jest.fn(async () => ({ installed: true })),
}));
jest.mock("@/lib/platform/connectors/scanner/install", () => ({
	describeTrustablRuntime: jest.fn(),
	installTrustablCli: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	invalidateSourceSecretCache: jest.fn(),
	resolveSourceSecret: jest.fn(async () => ({ raw: "", credentials: { githubToken: "ghp_connector_token" } })),
}));
jest.mock("@/lib/platform/connectors/scanner/enrich-providers", () => ({
	listScannerEnrichProviders: jest.fn(async () => [{ id: "anthropic", hasKey: true }]),
	resolveScannerEnrichProviderKey: jest.fn(async () => "sk-ant-vault-key"),
}));

import {
	__resetScannerEnrichRegistryForTests,
	cancelScannerEnrich,
	discardScannerEnrich,
	getScannerEnrichRun,
	latestScannerEnrichRun,
	listScannerEnrichProvidersFor,
	startScannerEnrich,
} from "@/lib/platform/connectors/scanner/enrich-crud";
import { listScannerConnectors } from "@/lib/platform/connectors/scanner/crud";
import { resolveScannerEnrichProviderKey } from "@/lib/platform/connectors/scanner/enrich-providers";
import { probeTrustablRuntime } from "@/lib/platform/connectors/scanner/runtime";
import type { ScannerEnrichRequest, ScannerFinding, ScannerJob } from "@/lib/platform/connectors/scanner/types";
import {
	SCANNER_CONNECTOR_NOT_FOUND,
	SCANNER_ENRICH_FINDING_NOT_FOUND,
	SCANNER_ENRICH_KEY_MISSING,
	SCANNER_ENRICH_NO_LOCATION,
	SCANNER_ENRICH_RUN_NOT_FOUND,
	SCANNER_ENRICH_RUNNING,
	SCANNER_JOB_NOT_FOUND,
	SCANNER_RUNTIME_NOT_INSTALLED,
} from "@/constants/messages/en";

const ID = "scanner:1";
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
	id: "job:1",
	status: "succeeded",
	target: "https://github.com/acme/agents",
	startedAt: "2026-11-12T00:00:00.000Z",
	findings,
	params: { rulesSource: "production", requireSigned: true, detectors: "claude_sdk" },
};
const input = { jobId: "job:1", alertNumber: 2, provider: "anthropic" as const, attempts: 1, recheck: true };

let release: () => void;

async function settle() {
	for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
	__resetScannerEnrichRegistryForTests();
	mockProject.id = "proj-1";
	mockRows.clear();
	mockRows.set(ID, {
		id: ID,
		projectId: "proj-1",
		category: "scanner",
		type: "trustabl",
		name: "Trustabl",
		settings: JSON.stringify({ target: job.target }),
		secretRef: "enc:v1:x",
		environment: "production",
		metadata: JSON.stringify({ category: "scanner", jobs: [job] }),
	});
	mockEnrich.mockReset();
	mockEnrich.mockImplementation(
		(request: ScannerEnrichRequest) =>
			new Promise((resolve) => {
				release = () => resolve({ status: "succeeded", diff: "--- a\n+++ b\n" });
				request.signal.addEventListener("abort", () => resolve({ status: "cancelled" }));
			})
	);
});

describe("startScannerEnrich", () => {
	it("persists a running run and hands the adapter the key, token and finding", async () => {
		const run = await startScannerEnrich(ID, input);
		expect(run).toMatchObject({ status: "running", jobId: "job:1", alertNumber: 2, ruleId: "CSDK-101" });
		expect(run.findingKey).toBe("CSDK-101|agent/agent.py|data-analyst|agent");
		expect(run.steps.map((step) => step.status)).toEqual(["running", "pending", "pending", "pending"]);
		const request = mockEnrich.mock.calls[0][0] as ScannerEnrichRequest;
		expect(request).toMatchObject({
			providerKey: "sk-ant-vault-key",
			githubToken: "ghp_connector_token",
			target: job.target,
			alertNumber: 2,
			rules: { rulesSource: "production", requireSigned: true },
		});
		expect(request.finding.ruleId).toBe("CSDK-101");
		const metadata = mockRows.get(ID)!.metadata;
		expect(metadata).not.toContain("sk-ant-vault-key");
		expect(metadata).not.toContain("ghp_connector_token");
	});

	it("records the final result when the adapter finishes", async () => {
		const run = await startScannerEnrich(ID, input);
		release();
		await settle();
		await expect(getScannerEnrichRun(ID, run.id)).resolves.toMatchObject({ status: "succeeded" });
	});

	it("records adapter progress", async () => {
		mockEnrich.mockImplementationOnce(async (request: ScannerEnrichRequest) => {
			await request.onProgress({ attempt: 1, commitSha: "abc" });
			return new Promise(() => undefined);
		});
		const run = await startScannerEnrich(ID, input);
		await settle();
		await expect(getScannerEnrichRun(ID, run.id)).resolves.toMatchObject({ status: "running", attempt: 1, commitSha: "abc" });
	});

	it("marks the run failed when the adapter throws", async () => {
		mockEnrich.mockRejectedValueOnce(new Error("boom"));
		const run = await startScannerEnrich(ID, input);
		await settle();
		await expect(getScannerEnrichRun(ID, run.id)).resolves.toMatchObject({ status: "failed", failure: "error", error: "boom" });
	});

	it.each([
		[{ ...input, jobId: "job:missing" }, SCANNER_JOB_NOT_FOUND],
		[{ ...input, alertNumber: 9 }, SCANNER_ENRICH_FINDING_NOT_FOUND],
		[{ ...input, alertNumber: 1 }, SCANNER_ENRICH_NO_LOCATION],
	])("rejects %p", async (body, message) => {
		await expect(startScannerEnrich(ID, body)).rejects.toThrow(message);
		expect(mockEnrich).not.toHaveBeenCalled();
	});

	it("refuses a second run while one is in progress", async () => {
		await startScannerEnrich(ID, input);
		await expect(startScannerEnrich(ID, input)).rejects.toThrow(SCANNER_ENRICH_RUNNING);
	});

	it("starts only one of two simultaneous runs", async () => {
		const results = await Promise.allSettled([startScannerEnrich(ID, input), startScannerEnrich(ID, input)]);
		expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
		const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
		expect(rejected.reason.message).toBe(SCANNER_ENRICH_RUNNING);
		expect(mockEnrich).toHaveBeenCalledTimes(1);
	});

	it("frees the connector when a start fails before running", async () => {
		(resolveScannerEnrichProviderKey as jest.Mock).mockRejectedValueOnce(
			new Error(SCANNER_ENRICH_KEY_MISSING("ANTHROPIC_API_KEY"))
		);
		await expect(startScannerEnrich(ID, input)).rejects.toThrow(SCANNER_ENRICH_KEY_MISSING("ANTHROPIC_API_KEY"));
		await expect(startScannerEnrich(ID, input)).resolves.toMatchObject({ status: "running" });
	});

	it("needs the Trustabl runtime", async () => {
		(probeTrustablRuntime as jest.Mock).mockResolvedValueOnce({ installed: false });
		await expect(startScannerEnrich(ID, input)).rejects.toThrow(SCANNER_RUNTIME_NOT_INSTALLED);
	});

	it("needs the provider key in Vault", async () => {
		(resolveScannerEnrichProviderKey as jest.Mock).mockRejectedValueOnce(
			new Error(SCANNER_ENRICH_KEY_MISSING("ANTHROPIC_API_KEY"))
		);
		await expect(startScannerEnrich(ID, input)).rejects.toThrow(SCANNER_ENRICH_KEY_MISSING("ANTHROPIC_API_KEY"));
		expect(mockRows.get(ID)!.metadata).not.toContain("enrich:");
	});

	it("is scoped to the current project", async () => {
		mockProject.id = "proj-2";
		await expect(startScannerEnrich(ID, input)).rejects.toThrow(SCANNER_CONNECTOR_NOT_FOUND);
	});
});

describe("enrich run lifecycle", () => {
	it("cancels a running run", async () => {
		const run = await startScannerEnrich(ID, input);
		await cancelScannerEnrich(ID, run.id);
		await settle();
		await expect(getScannerEnrichRun(ID, run.id)).resolves.toMatchObject({ status: "cancelled" });
	});

	it("finds the latest run for a finding", async () => {
		const run = await startScannerEnrich(ID, input);
		await expect(latestScannerEnrichRun(ID, "job:1", 2)).resolves.toMatchObject({ id: run.id });
		await expect(latestScannerEnrichRun(ID, "job:1", 3)).resolves.toBeNull();
	});

	it("discards a finished run and refuses a running one", async () => {
		const run = await startScannerEnrich(ID, input);
		await expect(discardScannerEnrich(ID, run.id)).rejects.toThrow(SCANNER_ENRICH_RUNNING);
		release();
		await settle();
		await discardScannerEnrich(ID, run.id);
		await expect(getScannerEnrichRun(ID, run.id)).rejects.toThrow(SCANNER_ENRICH_RUN_NOT_FOUND);
	});

	it("keeps runs out of the public connector metadata", async () => {
		await startScannerEnrich(ID, input);
		const [connector] = await listScannerConnectors("production");
		expect(connector.metadata).not.toContain("enrichRuns");
	});

	it("lists providers for a connector in the current project", async () => {
		await expect(listScannerEnrichProvidersFor(ID)).resolves.toEqual([{ id: "anthropic", hasKey: true }]);
		mockProject.id = "proj-2";
		await expect(listScannerEnrichProvidersFor(ID)).rejects.toThrow(SCANNER_CONNECTOR_NOT_FOUND);
	});
});
