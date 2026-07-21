/**
 * Snapshot derivation + upsertVersion idempotency.
 *
 * These tests stub the ClickHouse-touching `dataCollector` so we exercise the
 * decision logic (new version vs same-version bump) without a real DB.
 */

jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
	OTEL_LOGS_TABLE_NAME: "otel_logs",
}));

import { dataCollector } from "@/lib/platform/common";
import {
	upsertVersion,
	deriveSnapshot,
	getVersionTimeline,
	getLatestVersion,
	getLatestVersionsBatch,
	getVersion,
	getVersions,
	_internals,
} from "@/lib/platform/agents/snapshot";

const mockedDataCollector = dataCollector as jest.MockedFunction<typeof dataCollector>;

beforeEach(() => {
	mockedDataCollector.mockReset();
});

const baseSnapshot = {
	agent_key: "abc123",
	service_name: "my-agent",
	environment: "prod",
	cluster_id: "default",
	system_prompt: "You are helpful",
	tools: [],
	primary_model: "gpt-4o",
	models: ["gpt-4o"],
	providers: ["openai"],
	runtime_config: { temperature: 0.7 },
	request_count: 12,
	first_seen: "2026-05-11 22:00:00",
	last_seen: "2026-05-11 22:10:00",
	version_hash: "fingerprint00001",
};

describe("upsertVersion (atomic INSERT...SELECT)", () => {
	it("creates a new version when fingerprint changes", async () => {
		mockedDataCollector
			// 1. INSERT...SELECT (exec). The decision logic lives in ClickHouse
			//    SQL, not JS — we only verify the SQL was issued.
			.mockResolvedValueOnce({ data: [] })
			// 2. Read-back query reports the post-insert state. Since this is a
			//    brand new hash, request_count equals the snapshot's increment.
			.mockResolvedValueOnce({
				data: [
					{
						version_number: 4,
						version_hash: baseSnapshot.version_hash,
						request_count: 12,
					},
				],
			});

		const result = await upsertVersion(baseSnapshot);
		expect(result.versionNumber).toBe(4);
		expect(result.isNewVersion).toBe(true);

		// Insert ran first as exec (raw SQL) and embeds the snapshot fields.
		const insertCall = mockedDataCollector.mock.calls[0];
		expect(insertCall[1]).toBe("exec");
		const insertQuery = (insertCall[0] as any).query as string;
		expect(insertQuery).toContain("INSERT INTO openlit_agent_versions");
		expect(insertQuery).toContain("multiIf");
		expect(insertQuery).toContain(baseSnapshot.agent_key);
		expect(insertQuery).toContain(baseSnapshot.version_hash);
	});

	it("bumps the existing row when fingerprint is unchanged", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: [] })
			// Read-back shows aggregated request_count > snapshot increment ->
			// existing hash, no new version.
			.mockResolvedValueOnce({
				data: [
					{
						version_number: 7,
						version_hash: baseSnapshot.version_hash,
						request_count: 512,
					},
				],
			});

		const result = await upsertVersion(baseSnapshot);
		expect(result.versionNumber).toBe(7);
		expect(result.isNewVersion).toBe(false);
	});

	it("starts at version 1 when no history exists", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({
				data: [
					{
						version_number: 1,
						version_hash: baseSnapshot.version_hash,
						request_count: 12,
					},
				],
			});

		const result = await upsertVersion(baseSnapshot);
		expect(result.versionNumber).toBe(1);
		expect(result.isNewVersion).toBe(true);
	});

	it("returns defensive defaults when the read-back finds no row", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({ data: [] });

		const result = await upsertVersion(baseSnapshot);
		expect(result.versionNumber).toBe(1);
		expect(result.isNewVersion).toBe(true);
	});
});

describe("deriveSnapshot", () => {
	it("returns null when no GenAI spans were seen", async () => {
		mockedDataCollector.mockResolvedValueOnce({
			data: [{ request_count: 0 }],
		});
		const result = await deriveSnapshot({
			serviceName: "my-agent",
		});
		expect(result).toBeNull();
	});

	it("falls back to per-tool aggregation when both trace tool_definitions_json and otel_logs are empty", async () => {
		mockedDataCollector
			// 1) trace aggregation: tool_definitions_json empty, tools_fallback present
			.mockResolvedValueOnce({
				data: [
					{
						system_prompt: "You are helpful",
						tool_definitions_json: "",
						tools_fallback: [
							["search", "Search the web", "function"],
							["lookup", "Look up", "function"],
						],
						primary_model: "gpt-4o",
						models: ["gpt-4o"],
						providers: ["openai"],
						temperature: 0.7,
						top_p: 1,
						max_tokens: 1024,
						request_count: 42,
						first_seen: "2026-05-11 22:00:00",
						last_seen: "2026-05-11 22:10:00",
					},
				],
			})
			// 2) NEW: logs fallback query — also empty, so we fall through to tier 3
			.mockResolvedValueOnce({
				data: [{ tool_definitions_json: "" }],
			});

		const result = await deriveSnapshot({
			serviceName: "my-agent",
			environment: "prod",
			clusterId: "default",
		});
		expect(result).not.toBeNull();
		expect(result?.tools).toHaveLength(2);
		expect(result?.tools[0]).toEqual({
			name: "search",
			description: "Search the web",
			schema: null,
		});
		expect(result?.version_hash).toMatch(/^[a-f0-9]{16}$/);
	});

	it("uses otel_logs as a fallback when trace tool_definitions_json is empty", async () => {
		const logToolDefs = JSON.stringify([
			{
				type: "function",
				name: "lookup_weather",
				description: "Get the current weather forecast for a city.",
				parameters: {
					type: "object",
					properties: {
						city: { type: "string", description: "City name" },
					},
					required: ["city"],
				},
			},
		]);

		mockedDataCollector
			// 1) trace aggregation: tool_definitions_json empty, tools_fallback also
			//    present (would otherwise be picked up as tier 3) — proving the
			//    logs fallback wins over per-tool aggregation when both are
			//    available.
			.mockResolvedValueOnce({
				data: [
					{
						system_prompt: "You are a weather assistant",
						tool_definitions_json: "",
						tools_fallback: [
							["lookup_weather", "Get the current weather", "function"],
						],
						primary_model: "gpt-4o-mini",
						models: ["gpt-4o-mini"],
						providers: ["openai"],
						temperature: 0.7,
						top_p: 1,
						max_tokens: 1024,
						request_count: 7,
						first_seen: "2026-05-11 22:00:00",
						last_seen: "2026-05-11 22:10:00",
					},
				],
			})
			// 2) logs fallback returns the full tool definitions JSON
			.mockResolvedValueOnce({
				data: [{ tool_definitions_json: logToolDefs }],
			});

		const result = await deriveSnapshot({
			serviceName: "weather-agent",
			environment: "prod",
			clusterId: "default",
		});
		expect(result).not.toBeNull();
		expect(result?.tools).toHaveLength(1);
		expect(result?.tools[0].name).toBe("lookup_weather");
		expect(result?.tools[0].description).toBe(
			"Get the current weather forecast for a city."
		);
		// Critical: schema must be populated from the logs payload, NOT null
		// (which is what the per-tool aggregation tier 3 would yield).
		expect(result?.tools[0].schema).toEqual({
			type: "object",
			properties: {
				city: { type: "string", description: "City name" },
			},
			required: ["city"],
		});
	});

	it("skips the logs query when trace tool_definitions_json is non-empty", async () => {
		// Performance gate: if the trace span attribute already has tool defs
		// (agent-framework case), the materializer must NOT issue a second
		// roundtrip to otel_logs. We assert this by only mocking ONE response.
		mockedDataCollector.mockResolvedValueOnce({
			data: [
				{
					system_prompt: "Agent",
					tool_definitions_json: JSON.stringify([
						{
							type: "function",
							name: "framework_tool",
							description: "Set via agent framework span attribute",
							parameters: { type: "object", properties: {} },
						},
					]),
					tools_fallback: [],
					primary_model: "gpt-4o",
					models: ["gpt-4o"],
					providers: ["openai"],
					temperature: 0.5,
					top_p: 1,
					max_tokens: 512,
					request_count: 3,
					first_seen: "2026-05-11 22:00:00",
					last_seen: "2026-05-11 22:10:00",
				},
			],
		});

		const result = await deriveSnapshot({
			serviceName: "framework-agent",
			environment: "prod",
			clusterId: "default",
		});
		expect(result?.tools).toHaveLength(1);
		expect(result?.tools[0].name).toBe("framework_tool");
		// Exactly one dataCollector call — the logs fallback was correctly skipped.
		expect(mockedDataCollector).toHaveBeenCalledTimes(1);
	});
});

describe("snapshot internals", () => {
	it("normalizeWhitespace collapses runs and trims", () => {
		expect(_internals.normalizeWhitespace("  hello   world\n")).toBe(
			"hello world"
		);
	});

	it("canonicalJson sorts keys recursively", () => {
		const result = _internals.canonicalJson({
			b: { z: 1, a: 2 },
			a: 3,
		}) as Record<string, unknown>;
		expect(Object.keys(result)).toEqual(["a", "b"]);
		expect(Object.keys(result.b as Record<string, unknown>)).toEqual(["a", "z"]);
	});

	it("parseToolDefinitions handles OpenAI tool list shape", () => {
		const tools = _internals.parseToolDefinitions(
			JSON.stringify([
				{
					type: "function",
					function: { name: "search", description: "Search", parameters: { type: "object" } },
				},
			])
		);
		expect(tools).toEqual([
			{
				name: "search",
				description: "Search",
				schema: { type: "object" },
			},
		]);
	});

	it("parseToolDefinitions handles Anthropic tool list shape", () => {
		const tools = _internals.parseToolDefinitions(
			JSON.stringify([
				{
					name: "search",
					description: "Search",
					input_schema: { type: "object" },
				},
			])
		);
		expect(tools).toEqual([
			{
				name: "search",
				description: "Search",
				schema: { type: "object" },
			},
		]);
	});

	it("parseToolDefinitions ignores invalid entries", () => {
		const tools = _internals.parseToolDefinitions("not json");
		expect(tools).toEqual([]);
	});
});

describe("deriveSnapshot — providers attribute coalesce", () => {
	it("[REGRESSION] reads providers from gen_ai.provider.name (current OTel attr) with fallback to gen_ai.system", async () => {
		// OTel GenAI semantic conventions renamed `gen_ai.system` to
		// `gen_ai.provider.name` in 1.30. Earlier the materializer only
		// read the legacy key, so the openlit Python SDK's traces (which
		// emit only the new key) yielded `providers=[]` and the Agents
		// table showed "—" for every provider chip. Pin the coalesce in
		// the SQL so a future refactor can't drop one half of it.
		mockedDataCollector.mockResolvedValueOnce({ data: [] });
		const { deriveSnapshot } = await import("@/lib/platform/agents/snapshot");
		await deriveSnapshot({
			serviceName: "travel-assistant",
			environment: "default",
			clusterId: "default",
		});
		const sql = (mockedDataCollector.mock.calls[0][0] as any).query as string;
		expect(sql).toContain("gen_ai.provider.name");
		expect(sql).toContain("gen_ai.system");
		// Both keys appear in the providers projection (coalesce shape).
		expect(sql).toMatch(
			/SpanAttributes\['gen_ai\.provider\.name'\]\s*!=\s*''/
		);
		// And both keys appear in the row-filter WHERE clause so spans
		// carrying only the new key still qualify the agent.
		expect(sql).toMatch(
			/SpanAttributes\['gen_ai\.provider\.name'\]\s*!=\s*''[\s\S]*ServiceName/m
		);
	});
});

describe("getLatestVersion / getLatestVersionsBatch", () => {
	const versionRow = {
		agent_key: "abc123",
		version_hash: "hash-1",
		version_number: 3,
		system_prompt: "You are helpful",
		tools: "[]",
		primary_model: "gpt-4o",
		models: ["gpt-4o"],
		providers: ["openai"],
		runtime_config: "{}",
		first_seen: "2026-05-11 22:00:00",
		last_seen: "2026-05-11 22:10:00",
		request_count: 12,
		updated_at: "2026-05-11 22:10:00",
	};

	it("returns the latest version row for an agent", async () => {
		mockedDataCollector.mockResolvedValueOnce({ data: [versionRow] });

		const version = await getLatestVersion("abc123", "db-1");

		expect(version).toEqual(
			expect.objectContaining({
				agent_key: "abc123",
				version_number: 3,
				primary_model: "gpt-4o",
			})
		);
		expect(mockedDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({
				query: expect.stringContaining("agent_key = 'abc123'"),
			}),
			"query",
			"db-1"
		);
	});

	it("returns null on query error or empty rows", async () => {
		mockedDataCollector.mockResolvedValueOnce({ err: "db failed" });
		await expect(getLatestVersion("abc123")).resolves.toBeNull();

		mockedDataCollector.mockResolvedValueOnce({ data: [] });
		await expect(getLatestVersion("abc123")).resolves.toBeNull();
	});

	it("returns an empty map for empty key lists", async () => {
		await expect(getLatestVersionsBatch([])).resolves.toEqual(new Map());
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});

	it("batches latest versions and returns an empty map on error", async () => {
		mockedDataCollector.mockResolvedValueOnce({
			data: [versionRow, { ...versionRow, agent_key: "def456", version_number: 1 }],
		});

		const map = await getLatestVersionsBatch(["abc123", "def456"], "db-1");
		expect(map.size).toBe(2);
		expect(map.get("abc123")?.version_number).toBe(3);
		expect(map.get("def456")?.version_number).toBe(1);

		mockedDataCollector.mockResolvedValueOnce({ err: "batch failed" });
		await expect(getLatestVersionsBatch(["abc123"])).resolves.toEqual(new Map());
	});
});

describe("getVersionTimeline", () => {
	it("[REGRESSION] counts all spans per ServiceName instead of filtering to gen_ai.operation.name='chat'", async () => {
		// Agent-framework workloads (CrewAI, LangGraph, etc.) emit
		// task/crew/tool spans without `gen_ai.operation.name`. Filtering
		// the timeline by `'chat'` collapses the chart to empty for those
		// workloads even when REQUESTS (24H) > 0. Pin the broader filter
		// here so a future refactor can't reintroduce the regression.
		mockedDataCollector
			// 1) lookup row in openlit_agents_summary
			.mockResolvedValueOnce({
				data: [
					{
						service_name: "demo-crewai-app",
						environment: "default",
						cluster_id: "default",
					},
				],
			})
			// 2) getVersions call inside getVersionTimeline
			.mockResolvedValueOnce({ data: [] })
			// 3) the timeline span-count query
			.mockResolvedValueOnce({ data: [] });

		await getVersionTimeline("agentkey", { windowHours: 24 });

		const timelineQuery = (mockedDataCollector.mock.calls[2][0] as any)
			.query as string;
		expect(timelineQuery).toMatch(
			/ServiceName\s*=\s*'demo-crewai-app'/
		);
		expect(timelineQuery).not.toContain("gen_ai.operation.name");
	});

	it("returns empty buckets when the agent summary row is missing", async () => {
		mockedDataCollector.mockResolvedValueOnce({ data: [] });
		await expect(getVersionTimeline("missing")).resolves.toEqual({
			bucketSeconds: 3600,
			start: "",
			end: "",
			buckets: [],
		});
	});

	it("returns empty buckets when the timeline query errors", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({
				data: [{ service_name: "svc", environment: "prod", cluster_id: "c1" }],
			})
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({ err: "timeline failed" });

		await expect(getVersionTimeline("key")).resolves.toEqual({
			bucketSeconds: 3600,
			start: "",
			end: "",
			buckets: [],
		});
	});

	it("attributes empty direct_hash buckets via version first_seen fallback", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({
				data: [
					{
						service_name: "svc",
						environment: "staging",
						cluster_id: "default",
					},
				],
			})
			.mockResolvedValueOnce({
				data: [
					{
						agent_key: "abc123",
						version_hash: "hash-old",
						version_number: 1,
						system_prompt: "",
						tools: "[]",
						primary_model: "",
						models: [],
						providers: [],
						runtime_config: "{}",
						first_seen: "2026-05-11 20:00:00",
						last_seen: "2026-05-11 21:00:00",
						request_count: 1,
						updated_at: "2026-05-11 21:00:00",
					},
					{
						agent_key: "abc123",
						version_hash: "hash-new",
						version_number: 2,
						system_prompt: "",
						tools: "[]",
						primary_model: "",
						models: [],
						providers: [],
						runtime_config: "{}",
						first_seen: "2026-05-11 21:30:00",
						last_seen: "2026-05-11 22:00:00",
						request_count: 2,
						updated_at: "2026-05-11 22:00:00",
					},
				],
			})
			.mockResolvedValueOnce({
				data: [
					{
						bucket: "2026-05-11 21:00:00",
						direct_hash: "",
						requests: 3,
					},
					{
						bucket: "2026-05-11 22:00:00",
						direct_hash: "hash-new",
						requests: 4,
					},
					{
						bucket: "not-a-date",
						direct_hash: "",
						requests: 1,
					},
					{
						bucket: "2026-05-11 22:00:00",
						direct_hash: "hash-new",
						requests: 1,
					},
				],
			});

		const timeline = await getVersionTimeline("abc123", {
			bucketSeconds: 60,
			windowHours: 24,
		});

		expect(timeline.bucketSeconds).toBe(60);
		expect(timeline.buckets).toEqual(
			expect.arrayContaining([
				{ ts: "2026-05-11 21:00:00", versionHash: "hash-old", requests: 3 },
				{ ts: "2026-05-11 22:00:00", versionHash: "hash-new", requests: 5 },
				{ ts: "not-a-date", versionHash: "", requests: 1 },
			])
		);
		const issued = (mockedDataCollector.mock.calls[2][0] as any).query as string;
		expect(issued).toContain(
			"ResourceAttributes['deployment.environment'] = 'staging'"
		);
	});
});

describe("getVersion / getVersions", () => {
	const versionRow = {
		agent_key: "abc123",
		version_hash: "hash-1",
		version_number: 3,
		system_prompt: "You are helpful",
		tools: "[]",
		primary_model: "gpt-4o",
		models: ["gpt-4o"],
		providers: ["openai"],
		runtime_config: "{}",
		first_seen: "2026-05-11 22:00:00",
		last_seen: "2026-05-11 22:10:00",
		request_count: 12,
		updated_at: "2026-05-11 22:10:00",
	};

	it("returns a version by hash and null on miss/error", async () => {
		mockedDataCollector.mockResolvedValueOnce({ data: [versionRow] });
		await expect(getVersion("abc123", "hash-1", "db-1")).resolves.toEqual(
			expect.objectContaining({ version_hash: "hash-1", version_number: 3 })
		);

		mockedDataCollector.mockResolvedValueOnce({ data: [] });
		await expect(getVersion("abc123", "missing")).resolves.toBeNull();

		mockedDataCollector.mockResolvedValueOnce({ err: "boom" });
		await expect(getVersion("abc123", "hash-1")).resolves.toBeNull();
	});

	it("returns [] when getVersions errors", async () => {
		mockedDataCollector.mockResolvedValueOnce({ err: "boom" });
		await expect(getVersions("abc123")).resolves.toEqual([]);
	});
});

describe("deriveSnapshot / upsertVersion error paths", () => {
	it("returns null when the aggregate query errors", async () => {
		mockedDataCollector.mockResolvedValueOnce({ err: "aggregate failed" });
		await expect(
			deriveSnapshot({ serviceName: "svc", environment: "prod" })
		).resolves.toBeNull();
	});

	it("falls back when logs tool-definition fetch errors", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({
				data: [
					{
						system_prompt: "You are helpful",
						tool_definitions_json: "",
						tools_fallback: [["search", "Search", "function"]],
						primary_model: "gpt-4o",
						models: ["gpt-4o"],
						providers: ["openai"],
						temperature: 0.7,
						top_p: 1,
						max_tokens: 1024,
						request_count: 2,
						first_seen: "2026-05-11 22:00:00",
						last_seen: "2026-05-11 22:10:00",
					},
				],
			})
			.mockResolvedValueOnce({ err: "logs failed" });

		const result = await deriveSnapshot({ serviceName: "svc" });
		expect(result?.tools).toHaveLength(1);
		expect(result?.tools[0].name).toBe("search");
	});

	it("throws when upsertVersion insert errors", async () => {
		mockedDataCollector.mockResolvedValueOnce({ err: "insert failed" });
		await expect(upsertVersion(baseSnapshot)).rejects.toEqual("insert failed");
	});
});
