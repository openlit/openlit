import {
	denormalizeLogToClickHouseRow,
	denormalizeMetricPointsToListRows,
	denormalizeSpanToTraceRow,
	logStableRowId,
	normalizeLogRow,
	normalizeMetricRow,
	normalizeSpanRow,
} from "@/lib/platform/connectors/datasource/clickhouse/normalize";
import type {
	NormalizedLog,
	NormalizedMetricPoint,
	NormalizedSpan,
} from "@/lib/platform/connectors/datasource/types";

describe("normalizeSpanRow", () => {
	it("normalizes the array-of-objects Events form and prefers a top-level Cost column", () => {
		const span = normalizeSpanRow({
			TraceId: "t1",
			SpanId: "s1",
			ParentSpanId: "p1",
			SpanName: "chat",
			ServiceName: "svc",
			Timestamp: "2026-07-01T00:00:00Z",
			Duration: 1000,
			StatusCode: "STATUS_CODE_OK",
			StatusMessage: "ok",
			SpanKind: "SPAN_KIND_CLIENT",
			Cost: "0.5",
			SpanAttributes: { "gen_ai.usage.cost": "9.99" },
			ResourceAttributes: { "service.name": "svc" },
			Events: [{ Name: "ev1", Timestamp: "2026-07-01T00:00:01Z", Attributes: { a: "b" } }],
		});
		expect(span).toMatchObject({
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "p1",
			name: "chat",
			serviceName: "svc",
			statusMessage: "ok",
			spanKind: "SPAN_KIND_CLIENT",
			cost: 0.5,
		});
		expect(span.events).toEqual([
			{ name: "ev1", timestamp: "2026-07-01T00:00:01Z", attributes: { a: "b" } },
		]);
	});

	it("falls back to the gen_ai.usage.cost span attribute when Cost is absent", () => {
		const span = normalizeSpanRow({
			TraceId: "t1",
			SpanId: "s1",
			SpanAttributes: { "gen_ai.usage.cost": "1.25" },
		});
		expect(span.cost).toBe(1.25);
	});

	it("leaves cost undefined when neither Cost nor the attribute is present", () => {
		const span = normalizeSpanRow({ TraceId: "t1", SpanId: "s1" });
		expect(span.cost).toBeUndefined();
		expect(span.statusMessage).toBeUndefined();
		expect(span.spanKind).toBeUndefined();
	});

	it("normalizes the parallel-arrays Events form (Events.Name/.Timestamp/.Attributes)", () => {
		const span = normalizeSpanRow({
			TraceId: "t1",
			SpanId: "s1",
			"Events.Name": ["ev1", "ev2"],
			"Events.Timestamp": ["2026-07-01T00:00:01Z", ""],
			"Events.Attributes": [{ a: "1" }, undefined],
		});
		expect(span.events).toEqual([
			{ name: "ev1", timestamp: "2026-07-01T00:00:01Z", attributes: { a: "1" } },
			{ name: "ev2", timestamp: undefined, attributes: {} },
		]);
	});

	it("treats a null entry in the array-of-objects Events form as an empty event", () => {
		const span = normalizeSpanRow({
			TraceId: "t1",
			SpanId: "s1",
			Events: [null],
		});
		expect(span.events).toEqual([{ name: "", timestamp: undefined, attributes: {} }]);
	});

	it("defaults events to [] when neither Events form is present", () => {
		const span = normalizeSpanRow({ TraceId: "t1", SpanId: "s1" });
		expect(span.events).toEqual([]);
	});

	it("treats a falsy Event.Timestamp (array-of-objects form) as undefined", () => {
		const span = normalizeSpanRow({
			TraceId: "t1",
			SpanId: "s1",
			Events: [{ Name: "ev1", Timestamp: "", Attributes: {} }],
		});
		expect(span.events?.[0].timestamp).toBeUndefined();
	});

	it("defaults Events.Timestamp/.Attributes to [] when only Events.Name is present (parallel-arrays form)", () => {
		const span = normalizeSpanRow({
			TraceId: "t1",
			SpanId: "s1",
			"Events.Name": ["ev1"],
		});
		expect(span.events).toEqual([
			{ name: "ev1", timestamp: undefined, attributes: {} },
		]);
	});
});

describe("denormalizeSpanToTraceRow", () => {
	it("defaults optional fields (ParentSpanId, StatusMessage, SpanKind) and skips overwriting an explicit cost attribute", () => {
		const span: NormalizedSpan = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "",
			name: "chat",
			serviceName: "svc",
			timestamp: "2026-07-01T00:00:00Z",
			durationNs: 100,
			statusCode: "STATUS_CODE_OK",
			spanAttributes: { "gen_ai.usage.cost": "already-set" },
			resourceAttributes: {},
			cost: 5,
		};
		const row = denormalizeSpanToTraceRow(span);
		expect(row).toMatchObject({
			ParentSpanId: "",
			StatusMessage: "",
			SpanKind: "",
			Links: [],
		});
		expect((row.SpanAttributes as Record<string, string>)["gen_ai.usage.cost"]).toBe(
			"already-set"
		);
	});

	it("defaults events to [] when the span has none, and falls back Timestamp/Attributes per event", () => {
		const span: NormalizedSpan = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "",
			name: "chat",
			serviceName: "svc",
			timestamp: "2026-07-01T00:00:00Z",
			durationNs: 100,
			statusCode: "STATUS_CODE_OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		const row = denormalizeSpanToTraceRow(span);
		expect(row.Events).toEqual([]);
		expect(row.ResourceAttributes).toEqual({});
	});

	it("defaults ResourceAttributes to {} when the span carries none", () => {
		const span: NormalizedSpan = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "",
			name: "chat",
			serviceName: "svc",
			timestamp: "2026-07-01T00:00:00Z",
			durationNs: 100,
			statusCode: "STATUS_CODE_OK",
			spanAttributes: {},
			resourceAttributes: undefined as unknown as Record<string, string>,
			events: [
				{
					name: "ev1",
					timestamp: undefined,
					attributes: undefined as unknown as Record<string, string>,
				},
			],
		};
		const row = denormalizeSpanToTraceRow(span);
		expect(row.ResourceAttributes).toEqual({});
		expect((row.Events as Array<Record<string, unknown>>)[0]).toMatchObject({
			Timestamp: "",
			Attributes: {},
		});
	});
});

describe("logStableRowId", () => {
	it("is deterministic for identical inputs and differs when a field changes", () => {
		const a = logStableRowId({
			timestamp: "2026-07-01T00:00:00Z",
			traceId: "t1",
			spanId: "s1",
			severityText: "ERROR",
			body: "boom",
		});
		const b = logStableRowId({
			timestamp: "2026-07-01T00:00:00Z",
			traceId: "t1",
			spanId: "s1",
			severityText: "ERROR",
			body: "boom",
		});
		const c = logStableRowId({
			timestamp: "2026-07-01T00:00:00Z",
			traceId: "t1",
			spanId: "s1",
			severityText: "ERROR",
			body: "different",
		});
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});

	it("handles missing optional identifying fields", () => {
		const id = logStableRowId({
			timestamp: "2026-07-01T00:00:00Z",
			traceId: undefined,
			spanId: undefined,
			severityText: undefined,
			body: "boom",
		});
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});
});

describe("denormalizeLogToClickHouseRow", () => {
	it("defaults optional fields when absent from the NormalizedLog", () => {
		const log: NormalizedLog = {
			timestamp: "2026-07-01T00:00:00Z",
			body: "boom",
			logAttributes: {},
			resourceAttributes: {},
		};
		const row = denormalizeLogToClickHouseRow(log);
		expect(row).toMatchObject({
			TraceId: "",
			SpanId: "",
			SeverityText: "",
			SeverityNumber: 0,
			ServiceName: "",
			ScopeName: "",
			ScopeVersion: "",
			LogAttributes: {},
			ResourceAttributes: {},
			ScopeAttributes: {},
		});
	});

	it("uses the provided scopeAttributes when present", () => {
		const log: NormalizedLog = {
			timestamp: "2026-07-01T00:00:00Z",
			body: "boom",
			logAttributes: {},
			resourceAttributes: {},
			scopeAttributes: { "scope.name": "my-lib" },
		};
		const row = denormalizeLogToClickHouseRow(log);
		expect(row.ScopeAttributes).toEqual({ "scope.name": "my-lib" });
	});

	it("defaults logAttributes/resourceAttributes to {} when undefined on the NormalizedLog", () => {
		const log = {
			timestamp: "2026-07-01T00:00:00Z",
			body: "boom",
			logAttributes: undefined,
			resourceAttributes: undefined,
		} as unknown as NormalizedLog;
		const row = denormalizeLogToClickHouseRow(log);
		expect(row.LogAttributes).toEqual({});
		expect(row.ResourceAttributes).toEqual({});
	});
});

describe("normalizeLogRow", () => {
	it("normalizes a full ClickHouse otel_logs row", () => {
		const log = normalizeLogRow({
			Timestamp: "2026-07-01T00:00:00Z",
			TraceId: "t1",
			SpanId: "s1",
			SeverityText: "ERROR",
			SeverityNumber: 17,
			Body: "boom",
			ServiceName: "svc",
			LogAttributes: { "user.id": "u1" },
			ResourceAttributes: { "service.name": "svc" },
			ScopeAttributes: { "scope.name": "lib" },
		});
		expect(log).toEqual({
			timestamp: "2026-07-01T00:00:00Z",
			traceId: "t1",
			spanId: "s1",
			severityText: "ERROR",
			severityNumber: 17,
			body: "boom",
			serviceName: "svc",
			logAttributes: { "user.id": "u1" },
			resourceAttributes: { "service.name": "svc" },
			scopeAttributes: { "scope.name": "lib" },
		});
	});

	it("defaults all optional fields to undefined/empty when the row is sparse", () => {
		const log = normalizeLogRow({ Timestamp: "2026-07-01T00:00:00Z", Body: "boom" });
		expect(log).toEqual({
			timestamp: "2026-07-01T00:00:00Z",
			traceId: undefined,
			spanId: undefined,
			severityText: undefined,
			severityNumber: undefined,
			body: "boom",
			serviceName: undefined,
			logAttributes: {},
			resourceAttributes: {},
			scopeAttributes: undefined,
		});
	});

	it("treats SeverityNumber 0 as present (not undefined) since it is explicitly set", () => {
		const log = normalizeLogRow({
			Timestamp: "2026-07-01T00:00:00Z",
			Body: "boom",
			SeverityNumber: 0,
		});
		expect(log.severityNumber).toBe(0);
	});
});

describe("normalizeMetricRow", () => {
	it("normalizes a full ClickHouse metric row, preferring TimeUnix over Timestamp", () => {
		const point = normalizeMetricRow({
			MetricName: "gen_ai.client.token.usage",
			MetricDescription: "tokens",
			MetricUnit: "tokens",
			ServiceName: "svc",
			TimeUnix: "2026-07-01T00:00:00Z",
			Timestamp: "2026-06-01T00:00:00Z",
			Value: "42",
			Attributes: { "gen_ai.token.type": "input" },
			ResourceAttributes: { "service.name": "svc" },
		});
		expect(point).toEqual({
			metricName: "gen_ai.client.token.usage",
			description: "tokens",
			unit: "tokens",
			serviceName: "svc",
			timestamp: "2026-07-01T00:00:00Z",
			value: 42,
			attributes: { "gen_ai.token.type": "input" },
			resourceAttributes: { "service.name": "svc" },
		});
	});

	it("falls back to Timestamp when TimeUnix is absent and defaults optional fields", () => {
		const point = normalizeMetricRow({
			MetricName: "m",
			Timestamp: "2026-07-01T00:00:00Z",
			Value: 1,
		});
		expect(point.timestamp).toBe("2026-07-01T00:00:00Z");
		expect(point.description).toBeUndefined();
		expect(point.unit).toBeUndefined();
		expect(point.serviceName).toBeUndefined();
		expect(point.attributes).toEqual({});
		expect(point.resourceAttributes).toEqual({});
	});

	it("defaults value to 0 for non-numeric Value", () => {
		const point = normalizeMetricRow({ MetricName: "m", Value: "not-a-number" });
		expect(point.value).toBe(0);
	});
});

describe("denormalizeMetricPointsToListRows (edge cases)", () => {
	it("defaults a missing point.serviceName to '' when grouping", () => {
		const points: NormalizedMetricPoint[] = [
			{
				metricName: "m",
				serviceName: undefined,
				timestamp: "2026-07-01T00:00:00.000Z",
				value: 5,
				attributes: {},
				resourceAttributes: {},
			},
		];
		const rows = denormalizeMetricPointsToListRows(points);
		expect(rows[0].serviceName).toBe("");
	});

	it("keeps the earlier point's latest value when a later point has an invalid timestamp", () => {
		const points: NormalizedMetricPoint[] = [
			{
				metricName: "m",
				serviceName: "svc",
				timestamp: "2026-07-01T00:00:00.000Z",
				value: 10,
				attributes: {},
				resourceAttributes: {},
			},
			{
				metricName: "m",
				serviceName: "svc",
				timestamp: "not-a-date",
				value: 999,
				attributes: {},
				resourceAttributes: {},
			},
		];
		const rows = denormalizeMetricPointsToListRows(points);
		expect(rows[0].latestValue).toBe(10);
		expect(rows[0].pointCount).toBe(2);
	});

	it("returns [] for an empty points array", () => {
		expect(denormalizeMetricPointsToListRows([])).toEqual([]);
	});

	it("seeds a new group's latest.ts as 0 when the first point's timestamp is invalid", () => {
		const points: NormalizedMetricPoint[] = [
			{
				metricName: "m",
				serviceName: "svc",
				timestamp: "not-a-date",
				value: 7,
				attributes: {},
				resourceAttributes: {},
			},
		];
		const rows = denormalizeMetricPointsToListRows(points);
		expect(rows[0].latestValue).toBe(7);
		expect(rows[0].lastSeen).toBe("not-a-date");
	});
});
