import {
	metricParamsToOpenLITQuery,
	toMetricParams,
} from "@/lib/platform/connectors/datasource/clickhouse/query-map";
import {
	denormalizeLogToClickHouseRow,
	denormalizeMetricPointsToListRows,
	denormalizeSpanToTraceRow,
} from "@/lib/platform/connectors/datasource/clickhouse/normalize";
import type {
	NormalizedLog,
	NormalizedMetricPoint,
	NormalizedSpan,
} from "@/lib/platform/connectors/datasource/types";

describe("metricParamsToOpenLITQuery", () => {
	it("maps time, pagination, status, and selectedConfig filters", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const query = metricParamsToOpenLITQuery({
			timeLimit: { start, end, type: "CUSTOM" },
			limit: 25,
			offset: 50,
			statusCode: ["STATUS_CODE_ERROR"],
			sorting: { type: "Timestamp", direction: "desc" },
			selectedConfig: {
				models: ["gpt-4o"],
				providers: ["openai"],
				spanNames: ["chat"],
				serviceNames: ["api"],
				environments: ["production"],
				versionFilter: {
					versionHash: "v1",
					firstSeen: "2026-07-01T00:00:00.000Z",
					lastSeen: "2026-07-01T01:00:00.000Z",
				},
				customFilters: [
					{ key: "gen_ai.operation.name", value: "chat", operator: "eq" },
				],
			},
		});

		expect(query.signal).toBe("traces");
		expect(query.aiSelector).toBe(true);
		expect(query.limit).toBe(25);
		expect(query.offset).toBe(50);
		expect(query.timeRange).toEqual({ start, end });
		expect(query.sort).toEqual([{ field: "Timestamp", direction: "desc" }]);
		expect(query.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ target: "status", op: "in" }),
				expect.objectContaining({
					key: "gen_ai.request.model",
					op: "in",
					value: ["gpt-4o"],
				}),
				expect.objectContaining({
					key: "gen_ai.system",
					value: ["openai"],
				}),
				expect.objectContaining({ target: "spanName", value: ["chat"] }),
				expect.objectContaining({
					key: "service.name",
					scope: "resource",
				}),
				expect.objectContaining({
					key: "deployment.environment",
					scope: "resource",
					value: ["production"],
				}),
				expect.objectContaining({
					key: "openlit.agent.version_hash",
					value: "v1",
				}),
				expect.objectContaining({
					key: "gen_ai.operation.name",
					value: "chat",
				}),
			])
		);
	});

	it("maps operationType llm/vectordb onto gen_ai.operation.name", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const llm = metricParamsToOpenLITQuery({
			timeLimit: { start, end, type: "CUSTOM" },
			operationType: "llm",
		} as any);
		expect(llm.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "gen_ai.operation.name",
					op: "neq",
					value: "vectordb",
				}),
			])
		);
		const vectordb = metricParamsToOpenLITQuery({
			timeLimit: { start, end, type: "CUSTOM" },
			operationType: "vectordb",
		} as any);
		expect(vectordb.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "gen_ai.operation.name",
					op: "eq",
					value: "vectordb",
				}),
			])
		);
	});

	it("maps a trace customFilter with attributeType Field/key SpanName to a spanName filter, and ignores other Field keys", () => {
		const query = metricParamsToOpenLITQuery({
			timeLimit: { start: new Date("2026-07-01"), end: new Date("2026-07-02"), type: "CUSTOM" },
			selectedConfig: {
				customFilters: [
					{ attributeType: "Field", key: "SpanName", value: "chat" },
					{ attributeType: "Field", key: "OtherField", value: "ignored" },
					{ key: "" },
				],
			},
		} as any);
		expect(query.filters).toEqual([
			{ target: "spanName", op: "eq", value: "chat" },
		]);
	});

	it("normalizes every custom filter operator alias (eq/neq/!=/contains/in) for traces", () => {
		const query = metricParamsToOpenLITQuery({
			timeLimit: { start: new Date("2026-07-01"), end: new Date("2026-07-02"), type: "CUSTOM" },
			selectedConfig: {
				customFilters: [
					{ key: "a", value: "1", operator: "eq" },
					{ key: "b", value: "2", operator: "neq" },
					{ key: "c", value: "3", op: "!=" },
					{ key: "d", value: "4", operator: "contains" },
					{ key: "e", value: ["5", "6"], operator: "in" },
					{ key: "f", value: "7" },
				],
			},
		} as any);
		expect(query.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: "a", op: "eq", value: "1" }),
				expect.objectContaining({ key: "b", op: "neq", value: "2" }),
				expect.objectContaining({ key: "c", op: "neq", value: "3" }),
				expect.objectContaining({ key: "d", op: "contains", value: "4" }),
				expect.objectContaining({ key: "e", op: "in", value: ["5", "6"] }),
				expect.objectContaining({ key: "f", op: "eq", value: "7" }),
			])
		);
	});

	it("scopes a trace customFilter via cf.scope even when attributeType is unset", () => {
		const query = metricParamsToOpenLITQuery({
			timeLimit: { start: new Date("2026-07-01"), end: new Date("2026-07-02"), type: "CUSTOM" },
			selectedConfig: {
				customFilters: [{ key: "cluster", value: "c1", scope: "resource" }],
			},
		} as any);
		expect(query.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ scope: "resource", key: "cluster", value: "c1" }),
			])
		);
	});

	it("maps the remaining trace selectedConfig filters", () => {
		const query = metricParamsToOpenLITQuery({
			timeLimit: { start: new Date("2026-07-01"), end: new Date("2026-07-02"), type: "CUSTOM" },
			selectedConfig: {
				traceTypes: ["chat"],
				applicationNames: ["my-app"],
				maxCost: 0.25,
				customFilters: [
					{ attributeType: "ResourceAttributes", key: "cluster", value: "prod" },
					{ attributeType: "SpanAttributes", key: "tenant.id", value: "tenant-1" },
				],
			},
		} as any);

		expect(query.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: "gen_ai.operation.name", value: ["chat"] }),
				expect.objectContaining({ scope: "resource", key: "service.name", value: ["my-app"] }),
				expect.objectContaining({ key: "gen_ai.usage.cost", op: "lte", value: 0.25 }),
				expect.objectContaining({ scope: "resource", key: "cluster" }),
				expect.objectContaining({ scope: "span", key: "tenant.id" }),
			])
		);
	});

	it("maps log-signal filters (services, severities, custom log attrs)", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const query = metricParamsToOpenLITQuery(
			{
				timeLimit: { start, end, type: "CUSTOM" },
				selectedConfig: {
					services: ["api"],
					severities: ["ERROR"],
					customFilters: [
						{ key: "user.id", value: "u1", attributeType: "LogAttributes" },
					],
				},
			},
			"logs"
		);
		expect(query.signal).toBe("logs");
		expect(query.aiSelector).toBe(false);
		expect(query.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ scope: "resource", key: "service.name" }),
				expect.objectContaining({ scope: "log", key: "severity", value: ["ERROR"] }),
				expect.objectContaining({ scope: "log", key: "user.id", value: "u1" }),
			])
		);
	});

	it("scopes a log customFilter via cf.scope even when attributeType is unset", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const query = metricParamsToOpenLITQuery(
			{
				timeLimit: { start, end, type: "CUSTOM" },
				selectedConfig: {
					customFilters: [
						{ key: "cluster", value: "c1", scope: "resource" },
						{ key: "" },
					],
				},
			},
			"logs"
		);
		expect(query.filters).toEqual([
			expect.objectContaining({ scope: "resource", key: "cluster", value: "c1" }),
		]);
	});

	it("maps metric-signal filters (metricNames -> spanName target)", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const query = metricParamsToOpenLITQuery(
			{
				timeLimit: { start, end, type: "CUSTOM" },
				selectedConfig: {
					metricNames: ["gen_ai.client.token.usage"],
					services: ["api"],
				},
			},
			"metrics"
		);
		expect(query.signal).toBe("metrics");
		expect(query.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					target: "spanName",
					value: ["gen_ai.client.token.usage"],
				}),
				expect.objectContaining({ scope: "resource", key: "service.name" }),
			])
		);
	});

	it("defaults a metrics customFilter to scope 'metric' when neither attributeType nor cf.scope is resource", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const query = metricParamsToOpenLITQuery(
			{
				timeLimit: { start, end, type: "CUSTOM" },
				selectedConfig: {
					customFilters: [{ key: "unit", value: "ms" }],
				},
			},
			"metrics"
		);
		expect(query.filters).toEqual([
			expect.objectContaining({ scope: "metric", key: "unit", value: "ms" }),
		]);
	});

	it("scopes a metrics customFilter via cf.scope even when attributeType is unset", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const query = metricParamsToOpenLITQuery(
			{
				timeLimit: { start, end, type: "CUSTOM" },
				selectedConfig: {
					customFilters: [
						{ key: "cluster", value: "c1", scope: "resource" },
						{ key: "" },
					],
				},
			},
			"metrics"
		);
		expect(query.filters).toEqual([
			expect.objectContaining({ scope: "resource", key: "cluster", value: "c1" }),
		]);
	});

	it("scopes logs and metrics by agent serviceNames lock", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const selectedConfig = {
			serviceNames: ["demo-openai-app"],
			environments: ["production"],
		};

		const logs = metricParamsToOpenLITQuery(
			{ timeLimit: { start, end, type: "CUSTOM" }, selectedConfig },
			"logs"
		);
		expect(logs.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "service.name",
					value: ["demo-openai-app"],
				}),
				expect.objectContaining({
					key: "deployment.environment",
					value: ["production"],
				}),
			])
		);

		const metrics = metricParamsToOpenLITQuery(
			{ timeLimit: { start, end, type: "CUSTOM" }, selectedConfig },
			"metrics"
		);
		expect(metrics.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "service.name",
					value: ["demo-openai-app"],
				}),
				expect.objectContaining({
					key: "deployment.environment",
					value: ["production"],
				}),
			])
		);
	});

	it("does not emit a synthetic default deployment.environment filter", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const selectedConfig = {
			serviceNames: ["demo-openai-app"],
			environments: ["default"],
		};

		for (const signal of ["traces", "logs", "metrics"] as const) {
			const query = metricParamsToOpenLITQuery(
				{ timeLimit: { start, end, type: "CUSTOM" }, selectedConfig },
				signal
			);
			expect(query.filters || []).not.toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						key: "deployment.environment",
						value: ["default"],
					}),
				])
			);
			expect(query.filters).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						key: "service.name",
						value: ["demo-openai-app"],
					}),
				])
			);
		}
	});

	it("extracts a single (non-array) status filter value", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const back = toMetricParams({
			signal: "traces",
			timeRange: { start, end },
			filters: [{ target: "status", op: "eq", value: "STATUS_CODE_OK" }],
		});
		expect(back.statusCode).toEqual(["STATUS_CODE_OK"]);
	});

	it("parses a timeLimit.start/.end given as ISO strings (not Date instances)", () => {
		const query = metricParamsToOpenLITQuery({
			timeLimit: {
				start: "2026-07-01T00:00:00.000Z",
				end: "2026-07-01T01:00:00.000Z",
				type: "CUSTOM",
			},
		} as any);
		expect(query.timeRange.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
		expect(query.timeRange.end.toISOString()).toBe("2026-07-01T01:00:00.000Z");
	});

	it("passes through an asc sorting.direction unchanged", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const query = metricParamsToOpenLITQuery({
			timeLimit: { start, end, type: "CUSTOM" },
			sorting: { type: "Timestamp", direction: "asc" },
		});
		expect(query.sort).toEqual([{ field: "Timestamp", direction: "asc" }]);
	});

	it("defaults sort direction to desc for any non-asc sorting.direction", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const query = metricParamsToOpenLITQuery({
			timeLimit: { start, end, type: "CUSTOM" },
			sorting: { type: "Timestamp", direction: "descending" as any },
		});
		expect(query.sort).toEqual([{ field: "Timestamp", direction: "desc" }]);
	});

	it("ignores custom filters whose key is missing or non-string (traces/logs/metrics)", () => {
		const start = new Date("2026-07-01");
		const end = new Date("2026-07-02");
		for (const signal of ["traces", "logs", "metrics"] as const) {
			const query = metricParamsToOpenLITQuery(
				{
					timeLimit: { start, end, type: "CUSTOM" },
					selectedConfig: {
						customFilters: [{ value: "orphan" }, { key: 42, value: "num-key" }],
					},
				} as any,
				signal
			);
			expect(query.filters).toBeUndefined();
		}
	});

	it("defaults a Field/SpanName custom filter's value to '' when nullish", () => {
		const query = metricParamsToOpenLITQuery({
			timeLimit: { start: new Date("2026-07-01"), end: new Date("2026-07-02"), type: "CUSTOM" },
			selectedConfig: {
				customFilters: [{ attributeType: "Field", key: "SpanName", value: undefined }],
			},
		} as any);
		expect(query.filters).toEqual([{ target: "spanName", op: "eq", value: "" }]);
	});

	it("leaves a custom filter's value undefined when the source value is undefined", () => {
		const query = metricParamsToOpenLITQuery({
			timeLimit: { start: new Date("2026-07-01"), end: new Date("2026-07-02"), type: "CUSTOM" },
			selectedConfig: {
				customFilters: [{ key: "tenant.id", value: undefined }],
			},
		} as any);
		expect(query.filters).toEqual([
			expect.objectContaining({ key: "tenant.id", value: undefined }),
		]);
	});

	it("round-trips time/limit through toMetricParams", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const query = metricParamsToOpenLITQuery({
			timeLimit: { start, end, type: "CUSTOM" },
			limit: 10,
			statusCode: ["Error"],
		});
		const back = toMetricParams(query);
		expect(back.limit).toBe(10);
		expect(back.statusCode).toEqual(["Error"]);
		expect(back.timeLimit.type).toBe("CUSTOM");
		expect(back.timeLimit.start).toBe("2026-07-01T00:00:00.000Z");
		expect(back.timeLimit.end).toBe("2026-07-01T01:00:00.000Z");
	});

	it("carries a query sort through toMetricParams as a sorting object", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const back = toMetricParams({
			signal: "traces",
			timeRange: { start, end },
			sort: [{ field: "Timestamp", direction: "asc" }],
		});
		expect(back.sorting).toEqual({ type: "Timestamp", direction: "asc" });
	});

	it("leaves sorting undefined when the query has no sort", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const back = toMetricParams({
			signal: "traces",
			timeRange: { start, end },
		});
		expect(back.sorting).toBeUndefined();
	});

	it("round-trips generationHealth on the ClickHouse path without vendor filters", () => {
		const query = metricParamsToOpenLITQuery({
			timeLimit: {
				start: new Date("2026-07-01T00:00:00.000Z"),
				end: new Date("2026-07-01T01:00:00.000Z"),
				type: "CUSTOM",
			},
			selectedConfig: { generationHealth: ["truncated", "swapped"] },
		} as any);
		expect(query.generationHealth).toEqual(["truncated", "swapped"]);
		expect(query.filters || []).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: "openlit.generation.health" }),
			])
		);
		const back = toMetricParams(query);
		expect(back.selectedConfig.generationHealth).toEqual([
			"truncated",
			"swapped",
		]);
	});

	it("skips filters with no target/attribute match and non-attribute/no-key filters", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const back = toMetricParams({
			signal: "traces",
			timeRange: { start, end },
			filters: [
				{ target: "duration", op: "gt", value: 100 },
				{ target: "attribute", op: "eq", value: "x" },
			],
		});
		expect(back.selectedConfig.customFilters).toBeUndefined();
	});

	it("maps a spanName filter to metricNames for the metrics signal and spanNames otherwise", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const metrics = toMetricParams({
			signal: "metrics",
			timeRange: { start, end },
			filters: [{ target: "spanName", op: "in", value: ["gen_ai.client.token.usage"] }],
		});
		expect(metrics.selectedConfig.metricNames).toEqual(["gen_ai.client.token.usage"]);

		const traces = toMetricParams({
			signal: "traces",
			timeRange: { start, end },
			filters: [{ target: "spanName", op: "eq", value: "chat" }],
		});
		expect(traces.selectedConfig.spanNames).toEqual(["chat"]);
	});

	it("maps service.name to applicationNames for traces and services otherwise", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const traces = toMetricParams({
			signal: "traces",
			timeRange: { start, end },
			filters: [
				{ target: "attribute", key: "service.name", op: "in", value: ["api"] },
			],
		});
		expect(traces.selectedConfig.applicationNames).toEqual(["api"]);

		const logs = toMetricParams({
			signal: "logs",
			timeRange: { start, end },
			filters: [
				{ target: "attribute", key: "service.name", op: "in", value: ["api"] },
			],
		});
		expect(logs.selectedConfig.services).toEqual(["api"]);
	});

	it("maps trace-only known attribute keys to their legacy selectedConfig keys", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const back = toMetricParams({
			signal: "traces",
			timeRange: { start, end },
			filters: [
				{ target: "attribute", key: "gen_ai.request.model", op: "in", value: ["gpt-4o"] },
				{ target: "attribute", key: "gen_ai.system", op: "in", value: ["openai"] },
				{ target: "attribute", key: "gen_ai.operation.name", op: "in", value: ["chat"] },
				{ target: "attribute", key: "deployment.environment", op: "in", value: ["prod"] },
			],
		});
		expect(back.selectedConfig).toMatchObject({
			models: ["gpt-4o"],
			providers: ["openai"],
			traceTypes: ["chat"],
			environments: ["prod"],
		});
	});

	it("does not special-case the trace-only keys for logs/metrics signals (falls through to customFilters)", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const back = toMetricParams({
			signal: "logs",
			timeRange: { start, end },
			filters: [
				{ target: "attribute", key: "gen_ai.request.model", op: "eq", value: "gpt-4o" },
			],
		});
		expect(back.selectedConfig.models).toBeUndefined();
		expect(back.selectedConfig.customFilters).toEqual([
			{ attributeType: "LogAttributes", key: "gen_ai.request.model", value: "gpt-4o" },
		]);
	});

	it("chooses the customFilter attributeType by scope and signal (resource/log/metric/span defaults)", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const resourceScoped = toMetricParams({
			signal: "traces",
			timeRange: { start, end },
			filters: [
				{ target: "attribute", scope: "resource", key: "cluster", op: "eq", value: "c1" },
			],
		});
		expect(resourceScoped.selectedConfig.customFilters).toEqual([
			{ attributeType: "ResourceAttributes", key: "cluster", value: "c1" },
		]);

		const metricsScoped = toMetricParams({
			signal: "metrics",
			timeRange: { start, end },
			filters: [{ target: "attribute", key: "unit", op: "eq", value: "ms" }],
		});
		expect(metricsScoped.selectedConfig.customFilters).toEqual([
			{ attributeType: "Attributes", key: "unit", value: "ms" },
		]);

		const spanScoped = toMetricParams({
			signal: "traces",
			timeRange: { start, end },
			filters: [{ target: "attribute", key: "tenant.id", op: "eq", value: "t1" }],
		});
		expect(spanScoped.selectedConfig.customFilters).toEqual([
			{ attributeType: "SpanAttributes", key: "tenant.id", value: "t1" },
		]);
	});

	it("stringifies the first array value for a custom filter and defaults an undefined value to ''", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-01T01:00:00.000Z");
		const back = toMetricParams({
			signal: "traces",
			timeRange: { start, end },
			filters: [
				{ target: "attribute", key: "multi", op: "in", value: ["a", "b"] },
				{ target: "attribute", key: "novalue", op: "exists" },
			],
		});
		expect(back.selectedConfig.customFilters).toEqual([
			{ attributeType: "SpanAttributes", key: "multi", value: "a" },
			{ attributeType: "SpanAttributes", key: "novalue", value: "" },
		]);
	});

	it("falls back to the provided fallback Date when timeLimit.start is an unparsable string or the wrong type", () => {
		const query = metricParamsToOpenLITQuery({
			timeLimit: { start: "not-a-date", end: 12345 as unknown as Date, type: "CUSTOM" },
		} as any);
		// Both start and end should fall back to sane defaults rather than throw/NaN.
		expect(Number.isNaN(query.timeRange.start.getTime())).toBe(false);
		expect(Number.isNaN(query.timeRange.end.getTime())).toBe(false);
	});

	it("round-trips agentLoop on the ClickHouse path", () => {
		const query = metricParamsToOpenLITQuery({
			timeLimit: {
				start: new Date("2026-07-01T00:00:00.000Z"),
				end: new Date("2026-07-01T01:00:00.000Z"),
				type: "CUSTOM",
			},
			selectedConfig: { agentLoop: true },
		} as any);
		expect(query.agentLoop).toBe(true);
		const back = toMetricParams(query);
		expect(back.selectedConfig.agentLoop).toBe(true);
	});
});

describe("denormalizeSpanToTraceRow", () => {
	it("produces ClickHouse-shaped columns for the Telemetry UI", () => {
		const span: NormalizedSpan = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "p1",
			name: "chat",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 2_000_000,
			statusCode: "STATUS_CODE_OK",
			spanAttributes: { "gen_ai.request.model": "gpt-4o" },
			resourceAttributes: { "service.name": "api" },
			events: [
				{
					name: "gen_ai.content.prompt",
					timestamp: "2026-07-01T00:00:00.000Z",
					attributes: { "gen_ai.prompt": "hi" },
				},
			],
			cost: 0.01,
		};
		expect(denormalizeSpanToTraceRow(span)).toMatchObject({
			TraceId: "t1",
			SpanId: "s1",
			ParentSpanId: "p1",
			SpanName: "chat",
			ServiceName: "api",
			Duration: 2_000_000,
			Cost: 0.01,
			SpanAttributes: expect.objectContaining({
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.usage.cost": "0.01",
			}),
			Events: [
				expect.objectContaining({
					Name: "gen_ai.content.prompt",
					Attributes: { "gen_ai.prompt": "hi" },
				}),
			],
		});
	});
});

describe("denormalizeLogToClickHouseRow", () => {
	it("produces ClickHouse-shaped log columns with a stable rowId", () => {
		const log: NormalizedLog = {
			timestamp: "2026-07-01T00:00:00.000Z",
			traceId: "t1",
			spanId: "s1",
			severityText: "ERROR",
			severityNumber: 17,
			body: "boom",
			serviceName: "api",
			logAttributes: { "user.id": "u1" },
			resourceAttributes: { "service.name": "api" },
		};
		const row = denormalizeLogToClickHouseRow(log);
		expect(row).toMatchObject({
			Timestamp: "2026-07-01T00:00:00.000Z",
			TraceId: "t1",
			SpanId: "s1",
			SeverityText: "ERROR",
			SeverityNumber: 17,
			Body: "boom",
			ServiceName: "api",
			LogAttributes: { "user.id": "u1" },
		});
		expect(typeof row.rowId).toBe("string");
		// Deterministic: same input -> same rowId.
		expect(denormalizeLogToClickHouseRow(log).rowId).toBe(row.rowId);
	});
});

describe("denormalizeMetricPointsToListRows", () => {
	it("folds points into grouped list rows per metric + service", () => {
		const points: NormalizedMetricPoint[] = [
			{
				metricName: "m",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:00.000Z",
				value: 10,
				attributes: {},
				resourceAttributes: {},
			},
			{
				metricName: "m",
				serviceName: "api",
				timestamp: "2026-07-01T00:01:00.000Z",
				value: 20,
				attributes: {},
				resourceAttributes: {},
			},
		];
		const rows = denormalizeMetricPointsToListRows(points);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			metricName: "m",
			serviceName: "api",
			latestValue: 20,
			avgValue: 15,
			minValue: 10,
			maxValue: 20,
			pointCount: 2,
		});
	});
});
