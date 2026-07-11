import {
	metricParamsToOpenLITQuery,
	toMetricParams,
} from "@/lib/platform/datasource/clickhouse/query-map";
import {
	denormalizeLogToClickHouseRow,
	denormalizeMetricPointsToListRows,
	denormalizeSpanToTraceRow,
} from "@/lib/platform/datasource/clickhouse/normalize";
import type {
	NormalizedLog,
	NormalizedMetricPoint,
	NormalizedSpan,
} from "@/lib/platform/datasource/types";

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
