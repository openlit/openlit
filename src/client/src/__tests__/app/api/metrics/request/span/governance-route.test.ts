jest.mock("@/lib/platform/governance/trace-report", () => ({
	buildTraceGovernanceReport: jest.fn(),
}));
jest.mock("@/helpers/server/governance-analytics", () => ({
	fireGovernanceReportTelemetry: jest.fn(),
}));
jest.mock("@/lib/platform/intelligence/source", () => ({
	resolveIntelligenceClickHouseDbConfigId: jest
		.fn()
		.mockResolvedValue("intel-db-1"),
}));
jest.mock("@/lib/rbac/route", () => ({
	withDbConfigAccess: (handler: unknown) => handler,
}));

import { GET } from "@/app/api/metrics/request/span/[id]/governance/route";
import { buildTraceGovernanceReport } from "@/lib/platform/governance/trace-report";
import { fireGovernanceReportTelemetry } from "@/helpers/server/governance-analytics";
import { resolveIntelligenceClickHouseDbConfigId } from "@/lib/platform/intelligence/source";
import {
	GOVERNANCE_INVALID_SPAN_ID,
	GOVERNANCE_MISSING_SPAN_ID,
} from "@/constants/messages/en";

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

function makeRequest(
	spanId = "abc123",
	opts?: { traceId?: string; environment?: string; headerEnvironment?: string }
) {
	const params = new URLSearchParams();
	if (opts?.traceId) params.set("traceId", opts.traceId);
	if (opts?.environment) params.set("environment", opts.environment);
	const qs = params.size ? `?${params.toString()}` : "";
	return {
		url: `http://localhost/api/metrics/request/span/${spanId}/governance${qs}`,
		headers: {
			get: (name: string) =>
				name.toLowerCase() === "x-openlit-environment"
					? opts?.headerEnvironment || null
					: null,
		},
	} as Request;
}

describe("GET /api/metrics/request/span/[id]/governance", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("rejects missing span id", async () => {
		const response = await GET(makeRequest(), { params: {} });
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(GOVERNANCE_MISSING_SPAN_ID);
		expect(buildTraceGovernanceReport).not.toHaveBeenCalled();
		expect(fireGovernanceReportTelemetry).toHaveBeenCalledWith(
			expect.objectContaining({ success: false, reason: "missing_span" })
		);
	});

	it("rejects invalid span id before querying", async () => {
		const response = await GET(makeRequest("bad span"), {
			params: { id: "bad span" },
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(GOVERNANCE_INVALID_SPAN_ID);
		expect(buildTraceGovernanceReport).not.toHaveBeenCalled();
	});

	it("returns governance report and fires success telemetry", async () => {
		(buildTraceGovernanceReport as jest.Mock).mockResolvedValue({
			report: {
				trace_id: "trace-1",
				root_span_id: "span-1",
				risk_level: "minor",
				summary: "ok",
				harness: {
					span_count: 1,
					max_depth: 1,
					llm_call_count: 0,
					tool_call_count: 0,
					retrieval_call_count: 0,
					embedding_call_count: 0,
					database_call_count: 0,
					http_call_count: 0,
					error_count: 0,
					total_cost_usd: 0,
					total_duration_ms: 1,
					models_used: [],
					tools_used: [],
				},
				rules: [],
				security: [],
				evaluations: [],
				finding_count: 0,
				rule_match_count: 0,
			},
		});

		const response = await GET(makeRequest("span-1", { traceId: "trace-1" }), {
			params: { id: "span-1" },
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.report.trace_id).toBe("trace-1");
		expect(buildTraceGovernanceReport).toHaveBeenCalledWith(
			"span-1",
			expect.objectContaining({
				traceId: "trace-1",
				databaseConfigId: "intel-db-1",
			})
		);
		expect(fireGovernanceReportTelemetry).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				spanId: "span-1",
				riskLevel: "minor",
			})
		);
	});

	it("scopes the report to the selected connector environment", async () => {
		(buildTraceGovernanceReport as jest.Mock).mockResolvedValue({
			report: {
				trace_id: "trace-1",
				root_span_id: "span-1",
				risk_level: "none",
				summary: "ok",
				harness: {
					span_count: 1,
					max_depth: 1,
					llm_call_count: 0,
					tool_call_count: 0,
					retrieval_call_count: 0,
					embedding_call_count: 0,
					database_call_count: 0,
					http_call_count: 0,
					error_count: 0,
					total_cost_usd: 0,
					total_duration_ms: 1,
					models_used: [],
					tools_used: [],
				},
				rules: [],
				security: [],
				evaluations: [],
				finding_count: 0,
				rule_match_count: 0,
			},
		});

		await GET(
			makeRequest("span-1", {
				traceId: "trace-1",
				environment: "staging",
			}),
			{ params: { id: "span-1" } }
		);

		expect(buildTraceGovernanceReport).toHaveBeenCalledWith(
			"span-1",
			expect.objectContaining({
				traceId: "trace-1",
				environment: "staging",
				databaseConfigId: "intel-db-1",
			})
		);
	});

	it("falls back to the x-openlit-environment header for connector scoping", async () => {
		(buildTraceGovernanceReport as jest.Mock).mockResolvedValue({
			report: {
				trace_id: "trace-1",
				root_span_id: "span-1",
				risk_level: "none",
				summary: "ok",
				harness: {
					span_count: 1,
					max_depth: 1,
					llm_call_count: 0,
					tool_call_count: 0,
					retrieval_call_count: 0,
					embedding_call_count: 0,
					database_call_count: 0,
					http_call_count: 0,
					error_count: 0,
					total_cost_usd: 0,
					total_duration_ms: 1,
					models_used: [],
					tools_used: [],
				},
				rules: [],
				security: [],
				evaluations: [],
				finding_count: 0,
				rule_match_count: 0,
			},
		});

		await GET(
			makeRequest("span-1", { headerEnvironment: "production" }),
			{ params: { id: "span-1" } }
		);

		expect(buildTraceGovernanceReport).toHaveBeenCalledWith(
			"span-1",
			expect.objectContaining({
				environment: "production",
			})
		);
	});

	it("returns a controlled error when intelligence config resolution throws", async () => {
		(resolveIntelligenceClickHouseDbConfigId as jest.Mock).mockRejectedValueOnce(
			new Error("connector unavailable")
		);

		const response = await GET(makeRequest("span-1"), {
			params: { id: "span-1" },
		});
		expect(response.status).toBe(500);
		expect(buildTraceGovernanceReport).not.toHaveBeenCalled();
		expect(fireGovernanceReportTelemetry).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				spanId: "span-1",
				error: expect.stringContaining("connector unavailable"),
			})
		);
	});
});
