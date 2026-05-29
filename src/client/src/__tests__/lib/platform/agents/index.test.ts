/**
 * Unified agent listing query + computeAgentKey helper.
 */

jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
}));
jest.mock("@/lib/platform/agents/cache", () => ({
	swr: jest.fn(<T,>(_key: string, _policy: unknown, loader: () => Promise<T>) =>
		loader()
	),
	invalidate: jest.fn(),
	invalidatePrefix: jest.fn(),
	POLICY_LIST: {},
	POLICY_DETAIL: {},
	POLICY_VERSIONS: {},
	POLICY_TOOLS: {},
}));

import { dataCollector } from "@/lib/platform/common";
import { computeAgentKey, getAgent, listAgents } from "@/lib/platform/agents";

const mockedDataCollector = dataCollector as jest.MockedFunction<typeof dataCollector>;

beforeEach(() => {
	mockedDataCollector.mockReset();
});

describe("computeAgentKey", () => {
	it("is deterministic", () => {
		expect(computeAgentKey("c1", "prod", "svc")).toBe(
			computeAgentKey("c1", "prod", "svc")
		);
	});

	it("differs by cluster", () => {
		expect(computeAgentKey("c1", "prod", "svc")).not.toBe(
			computeAgentKey("c2", "prod", "svc")
		);
	});

	it("differs by service", () => {
		expect(computeAgentKey("c1", "prod", "a")).not.toBe(
			computeAgentKey("c1", "prod", "b")
		);
	});

	it("differs by environment", () => {
		expect(computeAgentKey("c1", "prod", "svc")).not.toBe(
			computeAgentKey("c1", "staging", "svc")
		);
	});

	it("uses defaults when fields are empty", () => {
		// Should not throw, and produce a 16-hex slug.
		const key = computeAgentKey("", "", "svc");
		expect(key).toMatch(/^[a-f0-9]{16}$/);
	});
});

describe("listAgents", () => {
	function makeRow(overrides: Record<string, unknown> = {}) {
		return {
			agent_key: "key1",
			service_name: "svc",
			environment: "prod",
			cluster_id: "default",
			source: "sdk",
			controller_service_id: "",
			controller_instance_id: "",
			primary_model: "gpt-4o",
			models: ["gpt-4o"],
			providers: ["openai"],
			tool_names: [],
			tool_count: 0,
			request_count_24h: 0,
			current_version_hash: "",
			current_version_number: 0,
			sdk_version: "",
			sdk_language: "",
			instrumentation_status: "discovered",
			desired_instrumentation_status: "none",
			agent_observability_status: "",
			desired_agent_status: "none",
			pending_action: "",
			pending_action_status: "",
			first_seen: "2026-05-11 22:00:00",
			last_seen: "2026-05-11 22:10:00",
			updated_at: "2026-05-11 22:10:00",
			last_materialized_at: "2026-05-11 22:10:00",
			pods_total: 0,
			pods_pending: 0,
			pods_acknowledged: 0,
			...overrides,
		};
	}

	it("returns rows and resolves null cursor when under limit", async () => {
		mockedDataCollector.mockResolvedValueOnce({
			data: [makeRow({ agent_key: "a" }), makeRow({ agent_key: "b" })],
		});
		const result = await listAgents({ limit: 10 });
		expect(result.data).toHaveLength(2);
		expect(result.nextCursor).toBeNull();
	});

	it("emits a cursor when results spill past the limit", async () => {
		const rows = [
			makeRow({ agent_key: "a", last_seen: "2026-05-11 22:10:00" }),
			makeRow({ agent_key: "b", last_seen: "2026-05-11 22:09:00" }),
			makeRow({ agent_key: "c", last_seen: "2026-05-11 22:08:00" }),
		];
		mockedDataCollector.mockResolvedValueOnce({ data: rows });
		const result = await listAgents({ limit: 2 });
		expect(result.data).toHaveLength(2);
		expect(result.nextCursor).toEqual({
			last_seen: "2026-05-11 22:09:00",
			agent_key: "b",
		});
	});

	it("translates an sdk source row to controller_service_id = null", async () => {
		mockedDataCollector.mockResolvedValueOnce({
			data: [makeRow({ source: "sdk", controller_service_id: "" })],
		});
		const result = await listAgents();
		expect(result.data[0].controller_service_id).toBeNull();
		expect(result.data[0].source).toBe("sdk");
	});

	it("preserves controller_service_id when present", async () => {
		mockedDataCollector.mockResolvedValueOnce({
			data: [
				makeRow({
					source: "controller",
					controller_service_id: "ctrl-uuid-1",
				}),
			],
		});
		const result = await listAgents();
		expect(result.data[0].controller_service_id).toBe("ctrl-uuid-1");
	});

	it("returns empty list when ClickHouse errors out", async () => {
		mockedDataCollector.mockResolvedValueOnce({ err: "boom", data: [] });
		const result = await listAgents();
		expect(result.data).toEqual([]);
		expect(result.nextCursor).toBeNull();
	});

	it("issues a query that JOINs the controller rollup CTEs (desired + actions + pod set)", async () => {
		mockedDataCollector.mockResolvedValueOnce({ data: [makeRow()] });
		await listAgents();
		const issuedQuery = (mockedDataCollector.mock.calls[0][0] as any).query as string;
		// Sanity-check the rollup is wired in. We don't pin the exact SQL
		// because incidental whitespace differences would make this brittle,
		// but every required join leg must be present.
		expect(issuedQuery).toMatch(/WITH pod_set AS/);
		expect(issuedQuery).toMatch(/desired_llm AS/);
		expect(issuedQuery).toMatch(/desired_agent AS/);
		expect(issuedQuery).toMatch(/pod_actions AS/);
		expect(issuedQuery).toMatch(/openlit_controller_desired_states_v2/);
		expect(issuedQuery).toMatch(/openlit_controller_actions/);
		expect(issuedQuery).toMatch(/LEFT JOIN pod_set/);
		expect(issuedQuery).toMatch(/LEFT JOIN pod_actions/);
	});

	it("[REGRESSION] FINAL comes after the alias (`AS s FINAL`, not `FINAL AS s`)", async () => {
		// ClickHouse rejects `FROM tbl FINAL AS s` with a syntax error.
		// FINAL must follow the alias. Caught in dev when the page rendered
		// zero rows despite the summary table being populated; pin the
		// fix here so a future SQL refactor doesn't regress silently.
		mockedDataCollector.mockResolvedValueOnce({ data: [makeRow()] });
		await listAgents();
		const issuedQuery = (mockedDataCollector.mock.calls[0][0] as any).query as string;
		expect(issuedQuery).toMatch(/FROM\s+\S+\s+AS\s+s\s+FINAL/);
		expect(issuedQuery).not.toMatch(/\sFINAL\s+AS\s+s/);
	});

	it("[REGRESSION] pod_action_latest does not shadow the updated_at column with an alias", async () => {
		// ClickHouse error: "Aggregate function max(updated_at) AS updated_at
		// is found inside another aggregate function" when the alias
		// shadows the source column referenced by argMax(..., updated_at).
		// We rename the aggregate to last_updated_at to keep the column
		// reference unambiguous.
		mockedDataCollector.mockResolvedValueOnce({ data: [makeRow()] });
		await listAgents();
		const issuedQuery = (mockedDataCollector.mock.calls[0][0] as any).query as string;
		expect(issuedQuery).toMatch(/max\(updated_at\)\s+AS\s+last_updated_at/);
		expect(issuedQuery).not.toMatch(/max\(updated_at\)\s+AS\s+updated_at/);
	});

	it("[REGRESSION] joins desired_agent / desired_llm / pod_set / pod_actions on s.workload_key", async () => {
		// Routing the desired-state joins through `pod_set.workload_key`
		// silently drops them when pod_set is empty (controller heartbeat
		// just missed its 5-minute window), causing the UI to report
		// desired_status='none' and reverting the spinner. Pin the new
		// `s.workload_key` join keys here so a future refactor can't
		// regress that.
		mockedDataCollector.mockResolvedValueOnce({ data: [makeRow()] });
		await listAgents();
		const issuedQuery = (mockedDataCollector.mock.calls[0][0] as any).query as string;
		expect(issuedQuery).toMatch(/desired_llm\.workload_key\s*=\s*s\.workload_key/);
		expect(issuedQuery).toMatch(/desired_agent\.workload_key\s*=\s*s\.workload_key/);
		expect(issuedQuery).toMatch(/pod_set\.workload_key\s*=\s*s\.workload_key/);
		expect(issuedQuery).toMatch(/pod_actions\.service_key\s*=\s*s\.workload_key/);
		// `s.workload_key` must be projected so callers can debug the
		// identity used by the rollup.
		expect(issuedQuery).toMatch(/s\.workload_key\s+AS\s+workload_key/);
	});

	it("[REGRESSION] agent_observability_status SQL fallback only fires for source='sdk', not 'both'", async () => {
		// Pre-fix the coalesce read `s.source IN ('sdk','both')` which
		// kept the actual observability status pinned to 'enabled' for
		// controller-managed workloads that happened to also emit SDK
		// traces in the materializer's 30-min window. After a Disable
		// click the controller correctly wrote agent_observability_status
		// = 'disabled' on its heartbeat, but the SELECT collapsed it
		// back to 'enabled' for source='both', so the UI never flipped
		// back to "Enable" until the SDK traces aged out. Pin the
		// narrower fallback here.
		mockedDataCollector.mockResolvedValueOnce({ data: [makeRow()] });
		await listAgents();
		const issuedQuery = (mockedDataCollector.mock.calls[0][0] as any).query as string;
		expect(issuedQuery).toMatch(
			/coalesce\(pod_set\.agent_observability_status,\s*if\(s\.source\s*=\s*'sdk',\s*'enabled',\s*''\)\)/
		);
		expect(issuedQuery).not.toMatch(/s\.source\s+IN\s*\(\s*'sdk'\s*,\s*'both'\s*\)/);
	});

	it("[REGRESSION] hides stale SDK-only rows whose last_seen is older than the freshness window", async () => {
		// Phantom SDK rows can linger in openlit_agents_summary when a
		// workload's service.name shifts after controller-managed recreate
		// (e.g. OBI briefly emits as `anthropic-app` before the SDK is
		// re-enabled with OTEL_SERVICE_NAME=demo-anthropic-app). The
		// materializer no longer refreshes those rows after the OBI fix,
		// but they persist in the table until the 90-day TTL. Pin the
		// SDK-specific freshness filter so we always hide them from the
		// list query.
		mockedDataCollector.mockResolvedValueOnce({ data: [makeRow()] });
		await listAgents();
		const issuedQuery = (mockedDataCollector.mock.calls[0][0] as any).query as string;
		expect(issuedQuery).toMatch(
			/s\.source\s*!=\s*'sdk'\s+OR\s+s\.last_seen\s*>=\s*now\(\)\s*-\s*INTERVAL\s+10\s+MINUTE/
		);
	});

	it("propagates workload_key into the UnifiedAgent shape", async () => {
		mockedDataCollector.mockResolvedValueOnce({
			data: [
				makeRow({
					source: "both",
					workload_key: "docker:demo-openai-app",
				}),
			],
		});
		const result = await listAgents();
		expect(result.data[0].workload_key).toBe("docker:demo-openai-app");
	});

	it("sources agent_observability_status from the pod_set resource_attributes rollup", async () => {
		// `agent_observability_status` is no longer materialized into the
		// summary row — it now comes from a controller-side argMax over
		// resource_attributes['openlit.agent_observability.status']. This
		// asserts both the SQL projection and the row reader pass it
		// straight through to UnifiedAgent.
		mockedDataCollector.mockResolvedValueOnce({
			data: [
				makeRow({
					source: "controller",
					controller_service_id: "ctrl-1",
					agent_observability_status: "manual",
				}),
			],
		});
		const result = await listAgents();
		expect(result.data[0].agent_observability_status).toBe("manual");
		const issuedQuery = (mockedDataCollector.mock.calls[0][0] as any).query as string;
		expect(issuedQuery).toMatch(
			/resource_attributes\['openlit\.agent_observability\.status'\]/
		);
		expect(issuedQuery).toMatch(/coalesce\(pod_set\.agent_observability_status/);
	});

	it("surfaces multi-pod rollup counts on the UnifiedAgent", async () => {
		// Simulates ClickHouse returning the rolled-up output from the new
		// CTEs: 3 pods total, 2 still pending an instrument action, 1
		// already acknowledged.
		mockedDataCollector.mockResolvedValueOnce({
			data: [
				makeRow({
					source: "controller",
					controller_service_id: "ctrl-1",
					controller_instance_id: "inst-1",
					instrumentation_status: "discovered",
					desired_instrumentation_status: "instrumented",
					pending_action: "instrument",
					pending_action_status: "pending",
					pods_total: 3,
					pods_pending: 2,
					pods_acknowledged: 1,
				}),
			],
		});
		const result = await listAgents();
		const row = result.data[0];
		expect(row.pods_total).toBe(3);
		expect(row.pods_pending).toBe(2);
		expect(row.pods_acknowledged).toBe(1);
		expect(row.pending_action).toBe("instrument");
		expect(row.pending_action_status).toBe("pending");
		expect(row.desired_instrumentation_status).toBe("instrumented");
	});

	it("rolls up to acknowledged when every pod has acknowledged its action", async () => {
		// All 5 pods finished acknowledging — caller can rely on
		// pods_pending===0 && pods_acknowledged===pods_total to drop the
		// optimistic intent.
		mockedDataCollector.mockResolvedValueOnce({
			data: [
				makeRow({
					source: "controller",
					controller_service_id: "ctrl-1",
					pending_action: "enable_python_sdk",
					pending_action_status: "acknowledged",
					pods_total: 5,
					pods_pending: 0,
					pods_acknowledged: 5,
				}),
			],
		});
		const result = await listAgents();
		const row = result.data[0];
		expect(row.pods_pending).toBe(0);
		expect(row.pods_acknowledged).toBe(5);
		expect(row.pending_action_status).toBe("acknowledged");
	});

	it("defaults pod counts to 0 when ClickHouse returns no rollup fields", async () => {
		mockedDataCollector.mockResolvedValueOnce({
			// Intentionally drop pods_* to simulate older / SDK-only rows.
			data: [
				{
					...makeRow(),
					pods_total: undefined,
					pods_pending: undefined,
					pods_acknowledged: undefined,
				},
			],
		});
		const result = await listAgents();
		const row = result.data[0];
		expect(row.pods_total).toBe(0);
		expect(row.pods_pending).toBe(0);
		expect(row.pods_acknowledged).toBe(0);
	});
});

describe("getAgent", () => {
	it("returns null when no row matches", async () => {
		mockedDataCollector.mockResolvedValueOnce({ data: [] });
		expect(await getAgent({ agentKey: "missing" })).toBeNull();
	});

	it("returns the row when one is found", async () => {
		mockedDataCollector.mockResolvedValueOnce({
			data: [
				{
					agent_key: "key1",
					service_name: "svc",
					environment: "prod",
					cluster_id: "default",
					source: "controller",
					controller_service_id: "ctrl-uuid",
					controller_instance_id: "inst-uuid",
					primary_model: "",
					models: [],
					providers: [],
					tool_names: [],
					tool_count: 0,
					request_count_24h: 0,
					current_version_hash: "",
					current_version_number: 0,
					sdk_version: "",
					sdk_language: "",
					instrumentation_status: "discovered",
					desired_instrumentation_status: "none",
					agent_observability_status: "",
					desired_agent_status: "none",
					pending_action: "",
					pending_action_status: "",
					first_seen: "2026-05-11 22:00:00",
					last_seen: "2026-05-11 22:10:00",
					updated_at: "2026-05-11 22:10:00",
					last_materialized_at: "2026-05-11 22:10:00",
					pods_total: 0,
					pods_pending: 0,
					pods_acknowledged: 0,
				},
			],
		});
		const agent = await getAgent({ agentKey: "key1" });
		expect(agent?.controller_service_id).toBe("ctrl-uuid");
		expect(agent?.source).toBe("controller");
		expect(agent?.pods_total).toBe(0);
	});

	it("issues a join against the rollup CTEs for the detail query as well", async () => {
		mockedDataCollector.mockResolvedValueOnce({ data: [] });
		await getAgent({ agentKey: "missing" });
		const issuedQuery = (mockedDataCollector.mock.calls[0][0] as any).query as string;
		expect(issuedQuery).toMatch(/WITH pod_set AS/);
		expect(issuedQuery).toMatch(/LEFT JOIN pod_actions/);
		// Same FINAL/alias ordering regression guard as on the list path.
		expect(issuedQuery).toMatch(/FROM\s+\S+\s+AS\s+s\s+FINAL/);
	});
});
