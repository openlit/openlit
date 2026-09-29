/**
 * Tests for adapter-backed agent discovery (`external-discovery.ts`).
 *
 * `discoverSdkRowsFromAdapter`/`discoverCodingRowsFromAdapter`/
 * `fetchRequestCountsFromAdapter`/`deriveSnapshotFromAdapter` only depend on
 * the `DataSourceAdapter` contract plus pure helpers (`computeAgentKey`,
 * `fingerprint`, `mergeProviders`), so we exercise them against a minimal
 * fake adapter rather than mocking modules.
 */

// `external-discovery.ts` imports `fingerprint` from `./snapshot`, which in
// turn imports `@/lib/platform/common` -> `@/lib/db-config` -> `@/lib/session`
// -> next-auth's ESM-only `openid-client`/`jose` chain. That chain isn't
// transformable under Jest's CJS transform, so we stub the leaf module the
// same way `materialize.test.ts`/`snapshot.test.ts` do to keep this a pure
// unit test of the discovery logic.
jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	intelligenceDataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
	OTEL_LOGS_TABLE_NAME: "otel_logs",
}));

import type {
	DataSourceAdapter,
	DiscoveredService,
	NormalizedSpan,
	ServiceRollup,
} from "@/lib/platform/connectors/datasource/types";
import {
	discoverSdkRowsFromAdapter,
	discoverCodingRowsFromAdapter,
	fetchRequestCountsFromAdapter,
	deriveSnapshotFromAdapter,
} from "@/lib/platform/agents/external-discovery";
import { computeAgentKey } from "@/lib/platform/agents/agent-key";
import { fingerprint } from "@/lib/platform/agents/snapshot";

function fakeAdapter(overrides: Partial<DataSourceAdapter> = {}): DataSourceAdapter {
	return {
		type: "fake",
		capabilities: jest.fn(),
		healthCheck: jest.fn(),
		validateAISignal: jest.fn(),
		listSpans: jest.fn(),
		getSpan: jest.fn(),
		getTraceSpans: jest.fn(),
		getSpansBySession: jest.fn(),
		aggregateSpans: jest.fn(),
		spanTimeSeries: jest.fn(),
		distinctValues: jest.fn(),
		attributeKeys: jest.fn(),
		listLogs: jest.fn(),
		getLog: jest.fn(),
		logTimeSeries: jest.fn(),
		listMetricSeries: jest.fn(),
		metricTimeSeries: jest.fn(),
		metricNames: jest.fn(),
		discoverServices: jest.fn(),
		aggregateByService: jest.fn(),
		sampleTracesForGraph: jest.fn(),
		...overrides,
	} as unknown as DataSourceAdapter;
}

function makeService(overrides: Partial<DiscoveredService> = {}): DiscoveredService {
	return {
		serviceName: "checkout-service",
		environment: "production",
		clusterId: "cluster-1",
		...overrides,
	};
}

function makeSpan(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
	return {
		traceId: "trace-1",
		spanId: "span-1",
		parentSpanId: "",
		name: "chat",
		serviceName: "svc",
		timestamp: "2026-05-11T22:00:00.000Z",
		durationNs: 1_000_000,
		statusCode: "OK",
		spanAttributes: {},
		resourceAttributes: {},
		...overrides,
	};
}

describe("discoverSdkRowsFromAdapter", () => {
	it("maps discovered services into SDK discovery rows, filling in defaults for missing fields", async () => {
		const discoverServices = jest.fn().mockResolvedValue([
			makeService({
				serviceName: "checkout-service",
				environment: "",
				clusterId: "",
				workloadKey: undefined,
				sdkVersion: undefined,
				sdkLanguage: undefined,
				firstSeen: undefined,
				lastSeen: undefined,
			}),
		]);
		const adapter = fakeAdapter({ discoverServices });

		const rows = await discoverSdkRowsFromAdapter(adapter, 45);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual(
			expect.objectContaining({
				service_name: "checkout-service",
				environment: "default",
				cluster_id: "default",
				workload_key: "",
				sdk_version: "",
				sdk_language: "",
			})
		);
		expect(typeof rows[0].first_seen).toBe("string");
		expect(typeof rows[0].last_seen).toBe("string");
	});

	it("preserves populated optional fields instead of overwriting with defaults", async () => {
		const discoverServices = jest.fn().mockResolvedValue([
			makeService({
				serviceName: "svc-a",
				environment: "staging",
				clusterId: "eu-west",
				workloadKey: "docker:svc-a",
				sdkVersion: "1.2.3",
				sdkLanguage: "python",
				firstSeen: "2026-01-01T00:00:00.000Z",
				lastSeen: "2026-01-02T00:00:00.000Z",
			}),
		]);
		const adapter = fakeAdapter({ discoverServices });

		const rows = await discoverSdkRowsFromAdapter(adapter);

		expect(rows[0]).toEqual({
			service_name: "svc-a",
			environment: "staging",
			cluster_id: "eu-west",
			workload_key: "docker:svc-a",
			sdk_version: "1.2.3",
			sdk_language: "python",
			first_seen: "2026-01-01T00:00:00.000Z",
			last_seen: "2026-01-02T00:00:00.000Z",
		});
	});

	it("excludes services with an empty/missing serviceName", async () => {
		const discoverServices = jest
			.fn()
			.mockResolvedValue([makeService({ serviceName: "" })]);
		const adapter = fakeAdapter({ discoverServices });

		const rows = await discoverSdkRowsFromAdapter(adapter);

		expect(rows).toEqual([]);
	});

	it("excludes services identified as coding-agent by sdkName === 'openlit-cli'", async () => {
		const discoverServices = jest.fn().mockResolvedValue([
			makeService({ serviceName: "some-cli", sdkName: "openlit-cli" }),
		]);
		const adapter = fakeAdapter({ discoverServices });

		const rows = await discoverSdkRowsFromAdapter(adapter);

		expect(rows).toEqual([]);
	});

	it.each(["cursor", "claude-code", "codex", "windsurf"])(
		"excludes services identified as coding-agent by serviceName === '%s'",
		async (name) => {
			const discoverServices = jest
				.fn()
				.mockResolvedValue([makeService({ serviceName: name })]);
			const adapter = fakeAdapter({ discoverServices });

			const rows = await discoverSdkRowsFromAdapter(adapter);

			expect(rows).toEqual([]);
		}
	);

	it("returns an empty array when discoverServices rejects", async () => {
		const discoverServices = jest
			.fn()
			.mockRejectedValue(new Error("adapter unreachable"));
		const adapter = fakeAdapter({ discoverServices });

		await expect(discoverSdkRowsFromAdapter(adapter)).resolves.toEqual([]);
	});

	it("clamps lookbackMinutes to a 30-minute floor when computing the query range", async () => {
		const discoverServices = jest.fn().mockResolvedValue([]);
		const adapter = fakeAdapter({ discoverServices });
		jest.useFakeTimers().setSystemTime(new Date(1_000_000_000_000));

		await discoverSdkRowsFromAdapter(adapter, 5);

		const range = discoverServices.mock.calls[0][0];
		expect(range.end.getTime()).toBe(1_000_000_000_000);
		expect(range.start.getTime()).toBe(1_000_000_000_000 - 30 * 60 * 1000);

		jest.useRealTimers();
	});

	it("uses lookbackMinutes directly when it exceeds the 30-minute floor", async () => {
		const discoverServices = jest.fn().mockResolvedValue([]);
		const adapter = fakeAdapter({ discoverServices });
		jest.useFakeTimers().setSystemTime(new Date(1_000_000_000_000));

		await discoverSdkRowsFromAdapter(adapter, 120);

		const range = discoverServices.mock.calls[0][0];
		expect(range.start.getTime()).toBe(1_000_000_000_000 - 120 * 60 * 1000);

		jest.useRealTimers();
	});
});

describe("discoverCodingRowsFromAdapter", () => {
	it("returns [] when no vendor-identifying attribute is present on any span", async () => {
		const sampleTracesForGraph = jest
			.fn()
			.mockResolvedValue([makeSpan({ serviceName: "unrelated-svc" })]);
		const adapter = fakeAdapter({ sampleTracesForGraph });

		const rows = await discoverCodingRowsFromAdapter(adapter);

		expect(rows).toEqual([]);
	});

	it("aggregates spans per vendor via spanAttributes coding_agent.client", async () => {
		const spans = [
			makeSpan({
				timestamp: "2026-05-11T22:00:00.000Z",
				spanAttributes: {
					"coding_agent.client": "cursor",
					"coding_agent.session.id": "session-1",
					"coding_agent.client.version": "1.0.0",
					"gen_ai.user.name": "alice",
					"gen_ai.usage.cost": "0.5",
				},
			}),
			makeSpan({
				timestamp: "2026-05-11T22:05:00.000Z",
				spanAttributes: {
					"coding_agent.client": "cursor",
					"coding_agent.session.id": "session-1",
					"gen_ai.user.name": "alice",
					"coding_agent.session.cost_usd": "0.25",
				},
			}),
			makeSpan({
				timestamp: "2026-05-11T21:55:00.000Z",
				spanAttributes: {
					"coding_agent.client": "cursor",
					"session.id": "session-2",
					"gen_ai.user.name": "bob",
				},
			}),
		];
		const sampleTracesForGraph = jest.fn().mockResolvedValue(spans);
		const adapter = fakeAdapter({ sampleTracesForGraph });

		const rows = await discoverCodingRowsFromAdapter(adapter);

		expect(rows).toHaveLength(1);
		expect(rows[0].vendor).toBe("cursor");
		expect(rows[0].client_version).toBe("1.0.0");
		expect(rows[0].session_count_24h).toBe(2);
		expect(rows[0].active_users_24h).toBe(2);
		expect(rows[0].cost_usd_24h).toBeCloseTo(0.75);
		expect(rows[0].first_seen).toBe("2026-05-11T21:55:00.000Z");
		expect(rows[0].last_seen).toBe("2026-05-11T22:05:00.000Z");
		// Untracked/legacy fields degrade to zero for the trace-sampled path.
		expect(rows[0].lines_added_24h).toBe(0);
		expect(rows[0].commit_count_24h).toBe(0);
	});

	it("identifies vendor via resourceAttributes coding_agent.client", async () => {
		const sampleTracesForGraph = jest.fn().mockResolvedValue([
			makeSpan({ resourceAttributes: { "coding_agent.client": "codex" } }),
		]);
		const adapter = fakeAdapter({ sampleTracesForGraph });

		const rows = await discoverCodingRowsFromAdapter(adapter);

		expect(rows).toHaveLength(1);
		expect(rows[0].vendor).toBe("codex");
	});

	it("identifies claude-code via resourceAttributes service.name fallback", async () => {
		const sampleTracesForGraph = jest.fn().mockResolvedValue([
			makeSpan({ resourceAttributes: { "service.name": "claude-code" } }),
		]);
		const adapter = fakeAdapter({ sampleTracesForGraph });

		const rows = await discoverCodingRowsFromAdapter(adapter);

		expect(rows).toHaveLength(1);
		expect(rows[0].vendor).toBe("claude-code");
	});

	it("identifies cursor via top-level serviceName fallback", async () => {
		const sampleTracesForGraph = jest.fn().mockResolvedValue([
			makeSpan({ serviceName: "cursor" }),
		]);
		const adapter = fakeAdapter({ sampleTracesForGraph });

		const rows = await discoverCodingRowsFromAdapter(adapter);

		expect(rows).toHaveLength(1);
		expect(rows[0].vendor).toBe("cursor");
	});

	it("uses coding_agent.hook.cli.version as a resource-attribute fallback for client_version", async () => {
		const sampleTracesForGraph = jest.fn().mockResolvedValue([
			makeSpan({
				spanAttributes: { "coding_agent.client": "windsurf" },
				resourceAttributes: { "coding_agent.hook.cli.version": "2.0.0" },
			}),
		]);
		const adapter = fakeAdapter({ sampleTracesForGraph });

		const rows = await discoverCodingRowsFromAdapter(adapter);

		expect(rows[0].client_version).toBe("2.0.0");
	});

	it("defaults session_count_24h to 1 when no session id was ever observed", async () => {
		const sampleTracesForGraph = jest.fn().mockResolvedValue([
			makeSpan({ spanAttributes: { "coding_agent.client": "cursor" } }),
		]);
		const adapter = fakeAdapter({ sampleTracesForGraph });

		const rows = await discoverCodingRowsFromAdapter(adapter);

		expect(rows[0].session_count_24h).toBe(1);
	});

	it("ignores a non-finite cost value instead of poisoning the running total", async () => {
		const sampleTracesForGraph = jest.fn().mockResolvedValue([
			makeSpan({
				spanAttributes: {
					"coding_agent.client": "cursor",
					"gen_ai.usage.cost": "not-a-number",
				},
			}),
		]);
		const adapter = fakeAdapter({ sampleTracesForGraph });

		const rows = await discoverCodingRowsFromAdapter(adapter);

		expect(rows[0].cost_usd_24h).toBe(0);
	});

	it("filters out vendors that aren't in the allow-list even if they were tracked", async () => {
		const sampleTracesForGraph = jest.fn().mockResolvedValue([
			makeSpan({ spanAttributes: { "coding_agent.client": "some-other-tool" } }),
		]);
		const adapter = fakeAdapter({ sampleTracesForGraph });

		const rows = await discoverCodingRowsFromAdapter(adapter);

		expect(rows).toEqual([]);
	});

	it("falls back to listSpans when sampleTracesForGraph throws", async () => {
		const sampleTracesForGraph = jest
			.fn()
			.mockRejectedValue(new Error("sampling unsupported"));
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [makeSpan({ serviceName: "cursor" })],
		});
		const adapter = fakeAdapter({ sampleTracesForGraph, listSpans });

		const rows = await discoverCodingRowsFromAdapter(adapter);

		expect(listSpans).toHaveBeenCalledTimes(1);
		expect(rows).toHaveLength(1);
		expect(rows[0].vendor).toBe("cursor");
	});

	it("returns [] when both sampleTracesForGraph and the listSpans fallback throw", async () => {
		const sampleTracesForGraph = jest
			.fn()
			.mockRejectedValue(new Error("sampling unsupported"));
		const listSpans = jest.fn().mockRejectedValue(new Error("listSpans failed"));
		const adapter = fakeAdapter({ sampleTracesForGraph, listSpans });

		await expect(discoverCodingRowsFromAdapter(adapter)).resolves.toEqual([]);
	});

	it("returns [] for an empty span sample", async () => {
		const sampleTracesForGraph = jest.fn().mockResolvedValue([]);
		const adapter = fakeAdapter({ sampleTracesForGraph });

		await expect(discoverCodingRowsFromAdapter(adapter)).resolves.toEqual([]);
	});
});

describe("fetchRequestCountsFromAdapter", () => {
	it("maps coding-source agents directly from their precomputed session count without calling aggregateByService", async () => {
		const aggregateByService = jest.fn();
		const adapter = fakeAdapter({ aggregateByService });

		const map = await fetchRequestCountsFromAdapter(adapter, [
			{
				agent_key: "coding-1",
				service_name: "cursor",
				environment: "default",
				cluster_id: "default",
				source: "coding",
				coding_session_count_24h: 7,
			},
		]);

		expect(map.get("coding-1")).toBe(7);
		expect(aggregateByService).not.toHaveBeenCalled();
	});

	it("defaults a coding agent's count to 0 when coding_session_count_24h is missing", async () => {
		const adapter = fakeAdapter();

		const map = await fetchRequestCountsFromAdapter(adapter, [
			{
				agent_key: "coding-2",
				service_name: "codex",
				environment: "default",
				cluster_id: "default",
				source: "coding",
			},
		]);

		expect(map.get("coding-2")).toBe(0);
	});

	it("matches traditional agents to rollups by (clusterId, environment, serviceName) agent_key", async () => {
		const rollup: ServiceRollup = {
			serviceName: "checkout-service",
			environment: "production",
			clusterId: "cluster-1",
			requestCount: 42,
			models: [],
			providers: [],
		};
		const aggregateByService = jest.fn().mockResolvedValue([rollup]);
		const adapter = fakeAdapter({ aggregateByService });
		const agentKey = computeAgentKey("cluster-1", "production", "checkout-service");

		const map = await fetchRequestCountsFromAdapter(adapter, [
			{
				agent_key: agentKey,
				service_name: "checkout-service",
				environment: "production",
				cluster_id: "cluster-1",
				source: "sdk",
			},
		]);

		expect(map.get(agentKey)).toBe(42);
	});

	it("falls back to matching by service_name alone when env/cluster produced no direct key match", async () => {
		const rollup: ServiceRollup = {
			serviceName: "checkout-service",
			environment: "",
			clusterId: "",
			requestCount: 15,
			models: [],
			providers: [],
		};
		const aggregateByService = jest.fn().mockResolvedValue([rollup]);
		const adapter = fakeAdapter({ aggregateByService });

		const map = await fetchRequestCountsFromAdapter(adapter, [
			{
				agent_key: "agent-without-matching-rollup-key",
				service_name: "checkout-service",
				environment: "production",
				cluster_id: "cluster-1",
				source: "sdk",
			},
		]);

		expect(map.get("agent-without-matching-rollup-key")).toBe(15);
	});

	it("defaults requestCount to 0 for a service-name-fallback match that omits it", async () => {
		const rollup = {
			serviceName: "checkout-service",
			environment: "",
			clusterId: "",
			models: [],
			providers: [],
		} as unknown as ServiceRollup;
		const aggregateByService = jest.fn().mockResolvedValue([rollup]);
		const adapter = fakeAdapter({ aggregateByService });

		const map = await fetchRequestCountsFromAdapter(adapter, [
			{
				agent_key: "no-direct-key-match",
				service_name: "checkout-service",
				environment: "production",
				cluster_id: "cluster-1",
				source: "sdk",
			},
		]);

		expect(map.get("no-direct-key-match")).toBe(0);
	});

	it("leaves an agent unmapped when no rollup matches it by key or by service_name", async () => {
		const rollup: ServiceRollup = {
			serviceName: "unrelated-service",
			environment: "production",
			clusterId: "cluster-1",
			requestCount: 5,
			models: [],
			providers: [],
		};
		const aggregateByService = jest.fn().mockResolvedValue([rollup]);
		const adapter = fakeAdapter({ aggregateByService });

		const map = await fetchRequestCountsFromAdapter(adapter, [
			{
				agent_key: "no-match-agent",
				service_name: "checkout-service",
				environment: "production",
				cluster_id: "cluster-1",
				source: "sdk",
			},
		]);

		expect(map.has("no-match-agent")).toBe(false);
	});

	it("does not overwrite an agent already matched by direct key with the service-name fallback", async () => {
		const agentKey = computeAgentKey("cluster-1", "production", "checkout-service");
		const rollups: ServiceRollup[] = [
			{
				serviceName: "checkout-service",
				environment: "production",
				clusterId: "cluster-1",
				requestCount: 100,
				models: [],
				providers: [],
			},
			{
				serviceName: "checkout-service",
				environment: "",
				clusterId: "",
				requestCount: 999,
				models: [],
				providers: [],
			},
		];
		const aggregateByService = jest.fn().mockResolvedValue(rollups);
		const adapter = fakeAdapter({ aggregateByService });

		const map = await fetchRequestCountsFromAdapter(adapter, [
			{
				agent_key: agentKey,
				service_name: "checkout-service",
				environment: "production",
				cluster_id: "cluster-1",
				source: "sdk",
			},
		]);

		expect(map.get(agentKey)).toBe(100);
	});

	it("defaults requestCount to 0 when a matched rollup omits it", async () => {
		const agentKey = computeAgentKey("cluster-1", "production", "checkout-service");
		const rollup = {
			serviceName: "checkout-service",
			environment: "production",
			clusterId: "cluster-1",
			models: [],
			providers: [],
		} as unknown as ServiceRollup;
		const aggregateByService = jest.fn().mockResolvedValue([rollup]);
		const adapter = fakeAdapter({ aggregateByService });

		const map = await fetchRequestCountsFromAdapter(adapter, [
			{
				agent_key: agentKey,
				service_name: "checkout-service",
				environment: "production",
				cluster_id: "cluster-1",
				source: "sdk",
			},
		]);

		expect(map.get(agentKey)).toBe(0);
	});

	it("returns an empty map when the agents list is empty and does not call aggregateByService", async () => {
		const aggregateByService = jest.fn();
		const adapter = fakeAdapter({ aggregateByService });

		const map = await fetchRequestCountsFromAdapter(adapter, []);

		expect(map.size).toBe(0);
		expect(aggregateByService).not.toHaveBeenCalled();
	});

	it("returns the coding-only map (without traditional entries) when aggregateByService rejects", async () => {
		const aggregateByService = jest
			.fn()
			.mockRejectedValue(new Error("aggregate failed"));
		const adapter = fakeAdapter({ aggregateByService });

		const map = await fetchRequestCountsFromAdapter(adapter, [
			{
				agent_key: "coding-1",
				service_name: "cursor",
				environment: "default",
				cluster_id: "default",
				source: "coding",
				coding_session_count_24h: 3,
			},
			{
				agent_key: "traditional-1",
				service_name: "checkout-service",
				environment: "production",
				cluster_id: "cluster-1",
				source: "sdk",
			},
		]);

		expect(map.get("coding-1")).toBe(3);
		expect(map.has("traditional-1")).toBe(false);
	});
});

describe("deriveSnapshotFromAdapter", () => {
	it("returns null when listSpans rejects", async () => {
		const listSpans = jest.fn().mockRejectedValue(new Error("query failed"));
		const adapter = fakeAdapter({ listSpans });

		await expect(
			deriveSnapshotFromAdapter(adapter, { serviceName: "svc" })
		).resolves.toBeNull();
	});

	it("returns null when no spans were sampled", async () => {
		const listSpans = jest.fn().mockResolvedValue({ fields: [], rows: [] });
		const adapter = fakeAdapter({ listSpans });

		await expect(
			deriveSnapshotFromAdapter(adapter, { serviceName: "svc" })
		).resolves.toBeNull();
	});

	it("derives a full snapshot from GenAI span attributes, defaulting environment/clusterId", async () => {
		const toolDefs = JSON.stringify([
			{ name: "search", description: "Search the web", parameters: { type: "object" } },
		]);
		const spans = [
			makeSpan({
				timestamp: "2026-05-11T22:10:00.000Z",
				spanAttributes: {
					"gen_ai.request.model": "gpt-4o",
					"gen_ai.system": "openai",
					"gen_ai.tool.definitions": toolDefs,
					"gen_ai.system_instructions": "You are helpful",
					"gen_ai.request.temperature": "0.7",
				},
			}),
			makeSpan({
				timestamp: "2026-05-11T22:00:00.000Z",
				spanAttributes: {
					"gen_ai.request.model": "gpt-4o-mini",
					"gen_ai.tool.name": "lookup",
				},
			}),
		];
		const listSpans = jest.fn().mockResolvedValue({ fields: [], rows: spans });
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, {
			serviceName: "weather-agent",
		});

		expect(result).not.toBeNull();
		expect(result?.environment).toBe("default");
		expect(result?.cluster_id).toBe("default");
		expect(result?.agent_key).toBe(
			computeAgentKey("default", "default", "weather-agent")
		);
		expect(result?.primary_model).toBe("gpt-4o");
		expect(result?.models).toEqual(
			expect.arrayContaining(["gpt-4o", "gpt-4o-mini"])
		);
		expect(result?.providers).toEqual(["openai"]);
		expect(result?.runtime_config.provider).toBe("openai");
		expect(result?.runtime_config.temperature).toBe(0.7);
		expect(result?.system_prompt).toBe("You are helpful");
		// tools includes the JSON-defined tool plus the toolName-only tool
		// merged in afterward without duplication.
		expect(result?.tools).toEqual(
			expect.arrayContaining([
				{ name: "search", description: "Search the web", schema: { type: "object" } },
				{ name: "lookup", description: "", schema: null },
			])
		);
		expect(result?.request_count).toBe(2);
		// first_seen picks the *last* array element's timestamp, last_seen the first's.
		expect(result?.first_seen).toBe("2026-05-11T22:00:00.000Z");
		expect(result?.last_seen).toBe("2026-05-11T22:10:00.000Z");
		expect(result?.version_hash).toBe(
			fingerprint({
				systemPrompt: "You are helpful",
				tools: result!.tools,
				primaryModel: "gpt-4o",
				runtimeConfig: result!.runtime_config,
				providers: result!.providers,
			})
		);
	});

	it("passes through explicit environment/clusterId and a floored lookbackMinutes", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [makeSpan()],
		});
		const adapter = fakeAdapter({ listSpans });

		await deriveSnapshotFromAdapter(adapter, {
			serviceName: "svc",
			environment: "staging",
			clusterId: "eu-west",
			lookbackMinutes: -5,
		});

		const query = listSpans.mock.calls[0][0];
		expect(query.signal).toBe("traces");
		expect(query.aiSelector).toBe(true);
		expect(query.limit).toBe(100);
		expect(query.filters).toEqual([
			{ target: "attribute", scope: "resource", key: "service.name", op: "eq", value: "svc" },
		]);
		// lookbackMinutes floors to 1 minute when a non-positive value is given.
		const rangeMs = query.timeRange.end.getTime() - query.timeRange.start.getTime();
		expect(rangeMs).toBe(60 * 1000);
	});

	it("uses gen_ai.prompt as a system_prompt fallback when system_instructions is absent", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				makeSpan({
					spanAttributes: { "gen_ai.prompt": "fallback prompt" },
				}),
			],
		});
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });

		expect(result?.system_prompt).toBe("fallback prompt");
	});

	it("keeps the first non-empty system_prompt across multiple spans", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				makeSpan({ spanAttributes: { "gen_ai.system_instructions": "first" } }),
				makeSpan({ spanAttributes: { "gen_ai.system_instructions": "second" } }),
			],
		});
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });

		expect(result?.system_prompt).toBe("first");
	});

	it("keeps the first temperature seen and ignores later spans' values", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				makeSpan({ spanAttributes: { "gen_ai.request.temperature": "0.2" } }),
				makeSpan({ spanAttributes: { "gen_ai.request.temperature": "0.9" } }),
			],
		});
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });

		expect(result?.runtime_config.temperature).toBe(0.2);
	});

	it("ignores malformed gen_ai.tool.definitions JSON without throwing", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				makeSpan({
					spanAttributes: { "gen_ai.tool.definitions": "{not-valid-json" },
				}),
			],
		});
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });

		expect(result?.tools).toEqual([]);
	});

	it("ignores gen_ai.tool.definitions that don't parse to an array", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				makeSpan({
					spanAttributes: {
						"gen_ai.tool.definitions": JSON.stringify({ not: "an array" }),
					},
				}),
			],
		});
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });

		expect(result?.tools).toEqual([]);
	});

	it("skips tool entries in the definitions array that don't carry a name", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				makeSpan({
					spanAttributes: {
						"gen_ai.tool.definitions": JSON.stringify([
							{ description: "no name here" },
							{ name: "valid_tool", description: "ok" },
						]),
					},
				}),
			],
		});
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });

		expect(result?.tools).toEqual([
			{ name: "valid_tool", description: "ok", schema: null },
		]);
	});

	it("falls back to t.schema when parameters is absent on a tool definition", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				makeSpan({
					spanAttributes: {
						"gen_ai.tool.definitions": JSON.stringify([
							{ name: "search", schema: { type: "string" } },
						]),
					},
				}),
			],
		});
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });

		expect(result?.tools[0].schema).toEqual({ type: "string" });
	});

	it("only parses gen_ai.tool.definitions from the first span that carries it (performance short-circuit)", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				makeSpan({
					spanAttributes: {
						"gen_ai.tool.definitions": JSON.stringify([{ name: "first_tool" }]),
					},
				}),
				makeSpan({
					spanAttributes: {
						"gen_ai.tool.definitions": JSON.stringify([{ name: "second_tool" }]),
					},
				}),
			],
		});
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });

		expect(result?.tools.map((t) => t.name)).toEqual(["first_tool"]);
	});

	it("merges gen_ai.tool.name-only spans without duplicating a tool already parsed from definitions", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				makeSpan({
					spanAttributes: {
						"gen_ai.tool.definitions": JSON.stringify([
							{ name: "search", description: "from-defs" },
						]),
						"gen_ai.tool.name": "search",
					},
				}),
			],
		});
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });

		expect(result?.tools).toEqual([
			{ name: "search", description: "from-defs", schema: null },
		]);
	});

	it("leaves runtime_config.provider empty when no providers were observed", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [makeSpan()],
		});
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });

		expect(result?.providers).toEqual([]);
		expect(result?.runtime_config.provider).toBeUndefined();
	});

	it("falls back to the current time for first_seen/last_seen when a span's timestamp is empty", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [makeSpan({ timestamp: "" })],
		});
		const adapter = fakeAdapter({ listSpans });

		const before = Date.now();
		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });
		const after = Date.now();

		expect(result?.first_seen).toBeDefined();
		expect(result?.last_seen).toBeDefined();
		const firstSeenMs = new Date(result!.first_seen).getTime();
		const lastSeenMs = new Date(result!.last_seen).getTime();
		expect(firstSeenMs).toBeGreaterThanOrEqual(before);
		expect(firstSeenMs).toBeLessThanOrEqual(after);
		expect(lastSeenMs).toBeGreaterThanOrEqual(before);
		expect(lastSeenMs).toBeLessThanOrEqual(after);
	});

	it("selects the alphabetically-first canonical provider when multiple are observed", async () => {
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				makeSpan({ spanAttributes: { "gen_ai.system": "openai" } }),
				makeSpan({ spanAttributes: { "gen_ai.system": "gcp.gemini" } }),
			],
		});
		const adapter = fakeAdapter({ listSpans });

		const result = await deriveSnapshotFromAdapter(adapter, { serviceName: "svc" });

		expect(result?.providers).toEqual(
			expect.arrayContaining(["openai", "gemini"])
		);
		// "gemini" < "openai" alphabetically.
		expect(result?.runtime_config.provider).toBe("gemini");
	});
});
