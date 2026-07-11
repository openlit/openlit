import {
	inferStructuredFromClickHouseSql,
	isLegacyOtelTracesSql,
} from "@/lib/platform/manage-dashboard/widget-sql-bridge";

describe("widget-sql-bridge", () => {
	it("detects otel_traces SQL and skips evaluation tables", () => {
		expect(isLegacyOtelTracesSql("SELECT count() FROM otel_traces")).toBe(true);
		expect(
			isLegacyOtelTracesSql(
				"SELECT count() FROM openlit_evaluation WHERE score > 0"
			)
		).toBe(false);
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
});
