/**
 * Tests for the agents materializer's SDK + controller dedup.
 *
 * The critical case: an SDK process emits traces under one service.name
 * (e.g. `openai-app`, the compose service key) while the controller
 * catalogues the same workload as `demo-openai-app` (the container_name).
 * Before workload_key dedup these became two rows in
 * openlit_agents_summary and the agents UI showed the same app twice.
 *
 * The fix is to inject `service.workload.key` into the SDK's resource
 * attributes during controller-managed enable. The materializer then
 * merges by `(cluster_id, workload_key)` first, falling back to
 * `(cluster, env, service_name)` for SDK-only / controller-only rows.
 */

jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
}));
jest.mock("@/lib/platform/agents/cache", () => ({
	swr: jest.fn(<T,>(_k: string, _p: unknown, loader: () => Promise<T>) =>
		loader()
	),
	invalidate: jest.fn(),
	invalidatePrefix: jest.fn(),
	POLICY_LIST: {},
	POLICY_DETAIL: {},
	POLICY_VERSIONS: {},
	POLICY_TOOLS: {},
}));
// Bypass the trace-derivation and version-upsert side effects — we only
// care about how summary rows are assembled.
jest.mock("@/lib/platform/agents/snapshot", () => ({
	deriveSnapshot: jest.fn().mockResolvedValue(null),
	upsertVersion: jest.fn(),
	getLatestVersionsBatch: jest.fn().mockResolvedValue(new Map()),
}));

import { dataCollector } from "@/lib/platform/common";
import {
	materializeAgents,
	recomputeCodingAgentsForWindow,
} from "@/lib/platform/agents/materialize";
import { computeAgentKey } from "@/lib/platform/agents";
import {
	deriveSnapshot,
	getLatestVersionsBatch,
	upsertVersion,
} from "@/lib/platform/agents/snapshot";

const mockedDC = dataCollector as jest.MockedFunction<typeof dataCollector>;
const mockedDerive = deriveSnapshot as jest.MockedFunction<typeof deriveSnapshot>;
const mockedUpsert = upsertVersion as jest.MockedFunction<typeof upsertVersion>;
const mockedGetLatest = getLatestVersionsBatch as jest.MockedFunction<
	typeof getLatestVersionsBatch
>;

interface RecordedInsert {
	table: string;
	values: Array<Record<string, unknown>>;
}

function captureInsertedRows(): RecordedInsert[] {
	const inserts: RecordedInsert[] = [];
	mockedDC.mockImplementation(async (config: any, op?: string) => {
		if (op === "insert") {
			inserts.push({
				table: String(config.table),
				values: (config.values || []) as Array<Record<string, unknown>>,
			});
			return { data: [] } as any;
		}
		// All "query" callsites should be primed by the test that runs
		// before this — fall through to the queued mock if any.
		return { data: [] } as any;
	});
	return inserts;
}

function queueDiscovery(
	sdkRows: Array<Record<string, unknown>>,
	ctrlRows: Array<Record<string, unknown>>,
	requestCountRows: Array<Record<string, unknown>> = [],
	codingRows: Array<Record<string, unknown>> = []
) {
	// `materializeAgents` fires `Promise.all([discoverAgents(),
	// discoverCodingAgents()])`. Inside `discoverAgents` two queries run
	// sequentially (SDK then controller); `discoverCodingAgents` fires
	// one. The microtask order under `Promise.all` is therefore:
	//   1) SDK discovery (kicked off first inside discoverAgents)
	//   2) Coding-agent discovery (kicked off by the second Promise.all entry)
	//   3) Controller discovery (resumes after SDK resolves)
	//   4) Request-count rollup (after both discovery functions resolve)
	mockedDC
		.mockResolvedValueOnce({ data: sdkRows } as any)
		.mockResolvedValueOnce({ data: codingRows } as any)
		.mockResolvedValueOnce({ data: ctrlRows } as any)
		.mockResolvedValueOnce({ data: requestCountRows } as any);
}

beforeEach(() => {
	mockedDC.mockReset();
	mockedDerive.mockReset();
	mockedUpsert.mockReset();
	mockedDerive.mockResolvedValue(null);
	mockedUpsert.mockResolvedValue({ versionNumber: 1, isNewVersion: false });
	mockedGetLatest.mockResolvedValue(new Map());
});

describe("materializeAgents — workload_key dedup", () => {
	it("merges an SDK row and a controller row sharing (cluster, workload_key) into a single 'both' row", async () => {
		// SDK emits as `openai-app` (compose service key); the controller
		// catalogues the same container as `demo-openai-app` (container_name).
		// Both carry workload_key='docker:demo-openai-app' — the SDK because
		// the controller injected it via OTEL_RESOURCE_ATTRIBUTES.
		queueDiscovery(
			[
				{
					service_name: "openai-app",
					environment: "default",
					cluster_id: "default",
					workload_key: "docker:demo-openai-app",
					sdk_version: "1.34.0",
					sdk_language: "python",
					first_seen: "2026-05-11 22:00:00",
					last_seen: "2026-05-11 22:10:00",
				},
			],
			[
				{
					id: "ctrl-svc-1",
					controller_instance_id: "inst-1",
					cluster_id: "default",
					service_name: "demo-openai-app",
					workload_key: "docker:demo-openai-app",
					instrumentation_status: "instrumented",
					resource_attributes: {
						"deployment.environment": "default",
					},
					first_seen: "2026-05-11 21:50:00",
					last_seen: "2026-05-11 22:10:00",
				},
			]
		);
		const inserts: RecordedInsert[] = [];
		// First three calls are the queued discovery queries; capture the
		// insert that follows.
		// `mockImplementation` (not `Once`) intentionally: the materializer
		// now runs an extra conflict-resolution SELECT before the final
		// summary INSERT when summaryRows contain any non-coding source.
		// That probe must be covered too, otherwise the unmocked call
		// returns `undefined` and the production code blows up reading
		// `res.err`. The implementation here short-circuits every non-
		// insert call with `{ data: [] }` so the conflict query sees
		// "no conflicting coding rows" and proceeds to the insert.
		mockedDC.mockImplementation(async (c: any, op?: string) => {
			if (op === "insert") {
				inserts.push({
					table: String(c.table),
					values: (c.values || []) as any,
				});
				return { data: [] } as any;
			}
			return { data: [] } as any;
		});

		await materializeAgents();

		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toHaveLength(1);
		const merged = inserts[0].values[0];
		expect(merged.source).toBe("both");
		// Canonical service_name is the controller's (the SDK's
		// `openai-app` collapses into `demo-openai-app`).
		expect(merged.service_name).toBe("demo-openai-app");
		expect(merged.workload_key).toBe("docker:demo-openai-app");
		expect(merged.controller_service_id).toBe("ctrl-svc-1");
		// The merged row is keyed by the controller's agent_key.
		expect(merged.agent_key).toBe(
			computeAgentKey("default", "default", "demo-openai-app")
		);
	});

	it("keeps SDK-only and controller-only rows as separate agents when their workload_key doesn't match", async () => {
		queueDiscovery(
			[
				{
					service_name: "sdk-only",
					environment: "default",
					cluster_id: "default",
					workload_key: "",
					sdk_version: "",
					sdk_language: "python",
					first_seen: "2026-05-11 22:00:00",
					last_seen: "2026-05-11 22:10:00",
				},
			],
			[
				{
					id: "ctrl-svc-2",
					controller_instance_id: "inst-1",
					cluster_id: "default",
					service_name: "controller-only",
					workload_key: "docker:controller-only",
					instrumentation_status: "discovered",
					resource_attributes: {},
					first_seen: "2026-05-11 22:00:00",
					last_seen: "2026-05-11 22:10:00",
				},
			]
		);
		const inserts: RecordedInsert[] = [];
		// `mockImplementation` (not `Once`) intentionally: the materializer
		// now runs an extra conflict-resolution SELECT before the final
		// summary INSERT when summaryRows contain any non-coding source.
		// That probe must be covered too, otherwise the unmocked call
		// returns `undefined` and the production code blows up reading
		// `res.err`. The implementation here short-circuits every non-
		// insert call with `{ data: [] }` so the conflict query sees
		// "no conflicting coding rows" and proceeds to the insert.
		mockedDC.mockImplementation(async (c: any, op?: string) => {
			if (op === "insert") {
				inserts.push({
					table: String(c.table),
					values: (c.values || []) as any,
				});
				return { data: [] } as any;
			}
			return { data: [] } as any;
		});

		await materializeAgents();

		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toHaveLength(2);
		const byName: Record<string, Record<string, unknown>> = {};
		for (const v of inserts[0].values) {
			byName[String(v.service_name)] = v;
		}
		expect(byName["sdk-only"].source).toBe("sdk");
		expect(byName["sdk-only"].workload_key).toBe("");
		expect(byName["controller-only"].source).toBe("controller");
		expect(byName["controller-only"].workload_key).toBe("docker:controller-only");
	});

	it("excludes OBI/eBPF-emitted spans from SDK discovery so they don't materialize phantom rows", async () => {
		// When LLM O11y is enabled before Agent O11y, OBI briefly emits a
		// few spans with telemetry.sdk.name='openlit' under the original
		// compose service name (e.g. `anthropic-app`) before the controller
		// recreates the container with OTEL_SERVICE_NAME set. Those spans
		// must NOT generate an SDK row in openlit_agents_summary, otherwise
		// the workload_key dedup cannot merge them with the controller row
		// (their workload_key is empty) and the agent shows up twice.
		const queries: string[] = [];
		mockedDC.mockImplementation(async (config: any, op?: string) => {
			if (op === "query") {
				queries.push(String(config.query));
				return { data: [] } as any;
			}
			return { data: [] } as any;
		});

		await materializeAgents();

		// First query is the SDK discovery CTE.
		expect(queries.length).toBeGreaterThan(0);
		const sdkQuery = queries[0];
		expect(sdkQuery).toContain("telemetry.distro.name");
		expect(sdkQuery).toContain("opentelemetry-ebpf-instrumentation");
		expect(sdkQuery).toMatch(
			/telemetry\.distro\.name'\]\s*!=\s*'opentelemetry-ebpf-instrumentation'/
		);
	});

	it("still merges SDK + controller on matching (cluster, env, service_name) when workload_key is empty (controller hasn't injected yet)", async () => {
		// Backwards-compat path: enabling Agent O11y is in flight, the
		// controller hasn't restarted the container with the workload_key
		// env var yet, so the SDK's traces have no workload_key. We fall
		// back to the legacy service_name match so we don't briefly
		// double-list the agent during rollout.
		queueDiscovery(
			[
				{
					service_name: "mixed-app",
					environment: "default",
					cluster_id: "default",
					workload_key: "",
					sdk_version: "1.34.0",
					sdk_language: "python",
					first_seen: "2026-05-11 22:00:00",
					last_seen: "2026-05-11 22:10:00",
				},
			],
			[
				{
					id: "ctrl-svc-3",
					controller_instance_id: "inst-1",
					cluster_id: "default",
					service_name: "mixed-app",
					workload_key: "docker:mixed-app",
					instrumentation_status: "instrumented",
					resource_attributes: { "deployment.environment": "default" },
					first_seen: "2026-05-11 22:00:00",
					last_seen: "2026-05-11 22:10:00",
				},
			]
		);
		const inserts: RecordedInsert[] = [];
		// `mockImplementation` (not `Once`) intentionally: the materializer
		// now runs an extra conflict-resolution SELECT before the final
		// summary INSERT when summaryRows contain any non-coding source.
		// That probe must be covered too, otherwise the unmocked call
		// returns `undefined` and the production code blows up reading
		// `res.err`. The implementation here short-circuits every non-
		// insert call with `{ data: [] }` so the conflict query sees
		// "no conflicting coding rows" and proceeds to the insert.
		mockedDC.mockImplementation(async (c: any, op?: string) => {
			if (op === "insert") {
				inserts.push({
					table: String(c.table),
					values: (c.values || []) as any,
				});
				return { data: [] } as any;
			}
			return { data: [] } as any;
		});

		await materializeAgents();

		expect(inserts[0].values).toHaveLength(1);
		expect(inserts[0].values[0].source).toBe("both");
		// Once the controller side reports a workload_key, the merged row
		// adopts it even if the SDK side didn't have one yet.
		expect(inserts[0].values[0].workload_key).toBe("docker:mixed-app");
	});

	it("propagates controller-detected llm_providers into the summary's providers when no trace-derived providers exist", async () => {
		// Regression test: before this fix, the agents table showed no
		// provider logo for freshly-discovered controller-only agents (e.g.
		// a Python process that just imported `openai` and `anthropic`)
		// because the materializer derived providers exclusively from
		// GenAI spans. The controller already detects providers via its
		// import-scan and surfaces them in openlit_controller_services
		// .llm_providers — we union those into providers so the table
		// renders the logos even before the first request lands.
		queueDiscovery(
			[],
			[
				{
					id: "ctrl-svc-4",
					controller_instance_id: "inst-1",
					cluster_id: "default",
					service_name: "fresh-controller-app",
					workload_key: "docker:fresh-controller-app",
					instrumentation_status: "discovered",
					resource_attributes: { "deployment.environment": "default" },
					llm_providers: ["openai", "anthropic"],
					first_seen: "2026-05-11 22:00:00",
					last_seen: "2026-05-11 22:10:00",
				},
			]
		);
		const inserts: RecordedInsert[] = [];
		// `mockImplementation` (not `Once`) intentionally: the materializer
		// now runs an extra conflict-resolution SELECT before the final
		// summary INSERT when summaryRows contain any non-coding source.
		// That probe must be covered too, otherwise the unmocked call
		// returns `undefined` and the production code blows up reading
		// `res.err`. The implementation here short-circuits every non-
		// insert call with `{ data: [] }` so the conflict query sees
		// "no conflicting coding rows" and proceeds to the insert.
		mockedDC.mockImplementation(async (c: any, op?: string) => {
			if (op === "insert") {
				inserts.push({
					table: String(c.table),
					values: (c.values || []) as any,
				});
				return { data: [] } as any;
			}
			return { data: [] } as any;
		});

		await materializeAgents();

		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toHaveLength(1);
		const row = inserts[0].values[0];
		expect(row.source).toBe("controller");
		expect(row.providers).toEqual(
			expect.arrayContaining(["openai", "anthropic"])
		);
	});

	it("reads controller llm_providers in the discovery query", async () => {
		// The select must project llm_providers so we can carry it through
		// to the summary. Without this, the column is undefined and
		// provider logos disappear even when the controller has detected
		// imports.
		const queries: string[] = [];
		mockedDC.mockImplementation(async (config: any, op?: string) => {
			if (op === "query") {
				queries.push(String(config.query));
				return { data: [] } as any;
			}
			return { data: [] } as any;
		});

		await materializeAgents();

		// Discovery now fires three concurrent queries (SDK, coding-agent,
		// controller) so positional indexing is unstable. Find the
		// controller query by its distinctive
		// `openlit_controller_services` source table.
		expect(queries.length).toBeGreaterThanOrEqual(2);
		const ctrlQuery = queries.find((q) =>
			q.includes("openlit_controller_services")
		);
		expect(ctrlQuery).toBeDefined();
		expect(ctrlQuery!).toMatch(/argMax\(s\.llm_providers,\s*s\.last_seen\)/);
		expect(ctrlQuery!).toMatch(/latest\.llm_providers\s+AS\s+llm_providers/);
	});
});

describe("recomputeCodingAgentsForWindow", () => {
	it("builds a 24h default window and maps vendor rows", async () => {
		mockedDC.mockResolvedValueOnce({
			data: [
				{
					vendor: "cursor",
					client_version: "1.2.3",
					first_seen: "2026-05-11 20:00:00",
					last_seen: "2026-05-11 22:00:00",
					session_count_24h: 5,
					cost_usd_24h: 1.5,
					active_users_24h: 2,
					lines_added_24h: 10,
					lines_removed_24h: 1,
					lines_accepted_24h: 8,
					lines_rejected_24h: 0,
					edit_accept_24h: 3,
					edit_reject_24h: 0,
					commit_count_24h: 1,
					pr_count_24h: 0,
				},
				{ vendor: "" },
			],
		} as any);

		const rows = await recomputeCodingAgentsForWindow({});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			service_name: "cursor",
			source: "coding",
			cluster_id: "coding",
			coding_session_count_24h: 5,
			coding_cost_usd_24h: 1.5,
			sdk_version: "1.2.3",
		});
		const query = String((mockedDC.mock.calls[0][0] as any).query);
		expect(query).toContain("Timestamp >= now() - INTERVAL 24 HOUR");
	});

	it("escapes custom window bounds and returns [] on error", async () => {
		mockedDC.mockResolvedValueOnce({ data: [] } as any);
		await recomputeCodingAgentsForWindow({
			timeStart: "2026-05-11T00:00:00Z",
			timeEnd: "2026-05-11 23:59:59",
		});
		const query = String((mockedDC.mock.calls[0][0] as any).query);
		expect(query).toContain(
			"parseDateTimeBestEffort('2026-05-11T00:00:00Z')"
		);
		expect(query).toContain("parseDateTimeBestEffort('2026-05-11 23:59:59')");

		mockedDC.mockResolvedValueOnce({
			err: new Error("coding discovery failed"),
			data: [],
		} as any);
		await expect(
			recomputeCodingAgentsForWindow({
				timeStart: "2026-05-11 00:00:00",
			})
		).resolves.toEqual([]);
	});

	it("escapes quotes in window timestamps", async () => {
		mockedDC.mockResolvedValueOnce({ data: [] } as any);
		await recomputeCodingAgentsForWindow({
			timeStart: "2026-05-11 00:00:00'; DROP TABLE x; --",
		});
		const query = String((mockedDC.mock.calls[0][0] as any).query);
		expect(query).toContain("\\'");
	});
});

describe("materializeAgents — scope / filter / coding", () => {
	it("returns processed:0 when scoped refresh finds no matching agent", async () => {
		mockedDC
			.mockResolvedValueOnce({ data: [] } as any) // SDK
			.mockResolvedValueOnce({ data: [] } as any) // coding
			.mockResolvedValueOnce({ data: [] } as any); // controller

		await expect(
			materializeAgents({
				scope: {
					serviceName: "cursor",
					clusterId: "coding",
					environment: "default",
				},
			})
		).resolves.toEqual({ processed: 0, newVersions: 0, errors: 0 });
	});

	it("materializes a coding agent matched by agentKeyFilter without snapshot upsert", async () => {
		const codingKey = computeAgentKey("coding", "default", "cursor");
		mockedDC
			// discoverAgents: SDK then controller (sequential)
			.mockResolvedValueOnce({ data: [] } as any)
			.mockResolvedValueOnce({ data: [] } as any)
			// discoverCodingAgents
			.mockResolvedValueOnce({
				data: [
					{
						vendor: "cursor",
						client_version: "9.0.0",
						first_seen: "2026-05-11 20:00:00",
						last_seen: "2026-05-11 22:00:00",
						session_count_24h: 2,
						cost_usd_24h: 0.4,
						active_users_24h: 1,
						lines_added_24h: 0,
						lines_removed_24h: 0,
						lines_accepted_24h: 0,
						lines_rejected_24h: 0,
						edit_accept_24h: 0,
						edit_reject_24h: 0,
						commit_count_24h: 0,
						pr_count_24h: 0,
					},
				],
			} as any);

		const inserts: RecordedInsert[] = [];
		mockedDC.mockImplementation(async (c: any, op?: string) => {
			if (op === "insert") {
				inserts.push({
					table: String(c.table),
					values: (c.values || []) as any,
				});
				return { data: [] } as any;
			}
			return { data: [] } as any;
		});

		const result = await materializeAgents({ agentKeyFilter: codingKey });
		expect(result.processed).toBe(1);
		expect(mockedDerive).not.toHaveBeenCalled();
		expect(mockedUpsert).not.toHaveBeenCalled();
		expect(inserts[0].values[0]).toMatchObject({
			agent_key: codingKey,
			source: "coding",
			service_name: "cursor",
			coding_agent_vendor: "cursor",
		});
	});

	it("returns empty when agentKeyFilter does not match", async () => {
		mockedDC
			.mockResolvedValueOnce({ data: [] } as any)
			.mockResolvedValueOnce({ data: [] } as any)
			.mockResolvedValueOnce({ data: [] } as any);

		await expect(
			materializeAgents({ agentKeyFilter: "nope" })
		).resolves.toEqual({ processed: 0, newVersions: 0, errors: 0 });
	});

	it("tolerates SDK/controller discovery errors", async () => {
		mockedDC
			.mockResolvedValueOnce({ err: new Error("sdk boom"), data: [] } as any)
			.mockResolvedValueOnce({ data: [] } as any) // coding
			.mockResolvedValueOnce({ err: new Error("ctrl boom"), data: [] } as any);

		await expect(materializeAgents()).resolves.toEqual({
			processed: 0,
			newVersions: 0,
			errors: 0,
		});
	});

	it("materializes scoped SDK matches and upserts versions when snapshot exists", async () => {
		mockedDerive.mockResolvedValueOnce({
			agent_key: computeAgentKey("default", "default", "scoped-app"),
			service_name: "scoped-app",
			environment: "default",
			cluster_id: "default",
			system_prompt: "hi",
			tools: [],
			primary_model: "gpt-4o",
			models: ["gpt-4o"],
			providers: ["openai"],
			runtime_config: {},
			request_count: 3,
			first_seen: "2026-05-11 22:00:00",
			last_seen: "2026-05-11 22:10:00",
			version_hash: "snap-hash",
		} as any);
		mockedUpsert.mockResolvedValueOnce({ versionNumber: 2, isNewVersion: true });

		mockedDC
			.mockResolvedValueOnce({
				data: [
					{
						service_name: "scoped-app",
						environment: "default",
						cluster_id: "default",
						workload_key: "",
						sdk_version: "1.0.0",
						sdk_language: "python",
						first_seen: "2026-05-11 22:00:00",
						last_seen: "2026-05-11 22:10:00",
					},
				],
			} as any)
			.mockResolvedValueOnce({ data: [] } as any) // coding
			.mockResolvedValueOnce({ data: [] } as any); // controller

		const inserts: RecordedInsert[] = [];
		mockedDC.mockImplementation(async (c: any, op?: string) => {
			if (op === "insert") {
				inserts.push({
					table: String(c.table),
					values: (c.values || []) as any,
				});
				return { data: [] } as any;
			}
			return { data: [] } as any;
		});

		const result = await materializeAgents({
			scope: { serviceName: "scoped-app", environment: "default" },
		});
		expect(result.processed).toBe(1);
		expect(result.newVersions).toBe(1);
		expect(mockedUpsert).toHaveBeenCalled();
		expect(inserts[0].values[0].current_version_hash).toBe("snap-hash");
	});
});
