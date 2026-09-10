import {
	inferStructuredFromClickHouseSql,
	isLegacyOtelTracesSql,
	percentChange,
	stripSyntheticDefaultEnvironment,
} from "@/lib/platform/manage-dashboard/widget-sql-bridge";
import type { OpenLITQuery } from "@/lib/platform/connectors/datasource/types";

describe("widget-sql-bridge", () => {
	it("detects otel_traces SQL and skips evaluation tables", () => {
		expect(isLegacyOtelTracesSql("SELECT count() FROM otel_traces")).toBe(true);
		expect(
			isLegacyOtelTracesSql(
				"SELECT count() FROM openlit_evaluation WHERE score > 0"
			)
		).toBe(false);
	});

	it("returns null percent change when previous period is zero", () => {
		expect(percentChange(14200, 0)).toBeNull();
		expect(percentChange(0, 0)).toBeNull();
		expect(percentChange(150, 100)).toBe(50);
		expect(percentChange(50, 100)).toBe(-50);
	});

	it("does not send the synthetic default environment to external sources", () => {
		const query = stripSyntheticDefaultEnvironment({
			signal: "traces",
			timeRange: { start: new Date("2026-07-28"), end: new Date("2026-07-29") },
			filters: [
				{
					target: "attribute",
					scope: "resource",
					key: "deployment.environment",
					op: "eq",
					value: "default",
				},
			],
		} satisfies OpenLITQuery);

		expect(query.filters).toBeUndefined();
	});

	it("infers total-request previous-period aggregate", () => {
		const inferred = inferStructuredFromClickHouseSql(`
			WITH prev_start_time AS x
			SELECT CAST(countIf(Timestamp >= start_time) AS INTEGER) AS total_request,
				CAST(countIf(Timestamp >= prev_start_time) AS INTEGER) AS total_request_previous,
				1 AS rate
			FROM otel_traces
		`);
		expect(inferred).toMatchObject({
			mode: "aggregate",
			includePrevious: true,
			primaryAlias: "total_request",
			previousAlias: "total_request_previous",
		});
		expect(inferred?.aggregations[0]).toEqual({
			fn: "count",
			as: "total_request",
		});
	});

	it("infers timeseries request counts", () => {
		const inferred = inferStructuredFromClickHouseSql(`
			SELECT CAST(COUNT(*) AS INTEGER) AS total,
				formatDateTime(DATE_TRUNC('hour', Timestamp), '%Y/%m/%d %R') AS request_time
			FROM otel_traces
			GROUP BY request_time
		`);
		expect(inferred).toMatchObject({
			mode: "timeseries",
			includePrevious: false,
			primaryAlias: "total",
		});
	});

	it("infers provider group-by", () => {
		const inferred = inferStructuredFromClickHouseSql(`
			SELECT SpanAttributes['gen_ai.system'] AS provider, CAST(COUNT(*) AS INTEGER) AS count
			FROM otel_traces
			GROUP BY provider
		`);
		expect(inferred?.groupBy).toEqual(["gen_ai.system"]);
		expect(inferred?.aggregations[0].fn).toBe("count");
	});

	it("infers models-per-time with total_model_count primary alias", () => {
		const inferred = inferStructuredFromClickHouseSql(`
			SELECT
				ARRAY_AGG(model) AS models,
				ARRAY_AGG(model_count) AS model_counts,
				CAST(SUM(model_count) AS INTEGER) AS total_model_count,
				formatDateTime(DATE_TRUNC('hour', Timestamp), '%Y/%m/%d %R') AS request_time
			FROM (
				SELECT
					SpanAttributes['gen_ai.request.model'] AS model,
					COUNT(*) AS model_count,
					formatDateTime(DATE_TRUNC('hour', Timestamp), '%Y/%m/%d %R') AS request_time
				FROM otel_traces
				GROUP BY model, request_time
			) AS sub
			GROUP BY request_time
		`);
		expect(inferred).toMatchObject({
			mode: "timeseries",
			primaryAlias: "total_model_count",
			groupBy: ["gen_ai.request.model"],
		});
		expect(inferred?.aggregations[0]).toEqual({
			fn: "count",
			as: "model_count",
		});
	});

	it("infers token usage timeseries with prompt and completion series", () => {
		const inferred = inferStructuredFromClickHouseSql(`
			SELECT
				CAST(SUM(toInt64OrZero(SpanAttributes['gen_ai.usage.total_tokens'])) AS INTEGER) AS total_tokens,
				CAST(SUM(toInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens'])) AS INTEGER) AS prompt_tokens,
				CAST(SUM(toInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens'])) AS INTEGER) AS completion_tokens,
				formatDateTime(DATE_TRUNC('day', Timestamp), '%Y/%m/%d %R') AS request_time
			FROM otel_traces
			GROUP BY request_time
		`);
		expect(inferred?.mode).toBe("timeseries");
		expect(inferred?.aggregations).toEqual(
			expect.arrayContaining([
				{ fn: "sum", field: "gen_ai.usage.total_tokens", as: "total_tokens" },
				{ fn: "sum", field: "gen_ai.usage.input_tokens", as: "prompt_tokens" },
				{ fn: "sum", field: "gen_ai.usage.output_tokens", as: "completion_tokens" },
			])
		);
	});

	it("round-trips structured query to ClickHouse SQL", () => {
		const { openLITQueryToClickHouseSql, inferredToStructuredQuery } =
			require("@/lib/platform/manage-dashboard/widget-sql-bridge") as typeof import("@/lib/platform/manage-dashboard/widget-sql-bridge");
		const inferred = inferStructuredFromClickHouseSql(`
			SELECT SpanAttributes['gen_ai.request.model'] AS model, CAST(COUNT(*) AS INTEGER) AS count
			FROM otel_traces
			GROUP BY model
		`);
		expect(inferred).not.toBeNull();
		const structured = inferredToStructuredQuery(inferred!);
		const sql = openLITQueryToClickHouseSql(
			structured.query as any,
			structured.mode
		);
		expect(sql).toContain("FROM otel_traces");
		expect(sql).toContain("gen_ai.request.model");
		expect(sql).toContain("count()");
	});

	it("does not treat prototype keys as aggregation aliases", () => {
		const inferred = inferStructuredFromClickHouseSql(`
			SELECT avg(SpanAttributes['gen_ai.usage.input_tokens']) AS constructor
			FROM otel_traces
		`);
		expect(inferred?.primaryAlias).not.toBe("constructor");
		expect(inferred?.primaryAlias).not.toBe("__proto__");
		expect(inferred?.primaryAlias).toBe("count");
	});
});
