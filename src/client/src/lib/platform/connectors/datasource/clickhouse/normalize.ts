/**
 * Normalizers: raw ClickHouse `otel_*` rows -> contract shapes.
 *
 * These convert the ClickHouse JSONEachRow representation (column names,
 * nested Events arrays, Map columns) into the vendor-agnostic
 * `NormalizedSpan` / `NormalizedLog` / `NormalizedMetricPoint` shapes so every
 * external adapter produces the same surface-facing structure.
 */

import type {
	NormalizedLog,
	NormalizedMetricPoint,
	NormalizedSpan,
	NormalizedSpanEvent,
} from "../types";

/**
 * Deterministic 53-bit hash for a set of fields. Built-in ClickHouse rows carry
 * a `cityHash64` rowId; external rows have no such id, so we synthesize a stable
 * one from the same identifying fields for React keys and detail lookups.
 */
function stableRowId(parts: string[]): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	const str = parts.join("\u0000");
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
	return String(hash);
}

function asString(value: unknown): string {
	if (value === null || value === undefined) return "";
	return String(value);
}

function asNumber(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

function asMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object") return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		out[k] = asString(v);
	}
	return out;
}

/**
 * Normalize span events. ClickHouse can return the Nested `Events` column
 * either as parallel arrays (`Events.Timestamp`, `Events.Name`,
 * `Events.Attributes`) or as an array of objects, depending on the query. We
 * handle both.
 */
function normalizeEvents(row: Record<string, unknown>): NormalizedSpanEvent[] {
	// Array-of-objects form.
	if (Array.isArray(row.Events)) {
		return (row.Events as unknown[]).map((ev) => {
			const e = (ev || {}) as Record<string, unknown>;
			return {
				name: asString(e.Name),
				timestamp: e.Timestamp ? asString(e.Timestamp) : undefined,
				attributes: asMap(e.Attributes),
			};
		});
	}
	// Parallel-arrays form.
	const names = row["Events.Name"];
	if (Array.isArray(names)) {
		const timestamps = (row["Events.Timestamp"] as unknown[]) || [];
		const attributes = (row["Events.Attributes"] as unknown[]) || [];
		return (names as unknown[]).map((name, i) => ({
			name: asString(name),
			timestamp: timestamps[i] ? asString(timestamps[i]) : undefined,
			attributes: asMap(attributes[i]),
		}));
	}
	return [];
}

/**
 * Convert a NormalizedSpan back into the ClickHouse-shaped row the Telemetry
 * UI already understands (`TraceId`, `SpanAttributes`, …). External adapters
 * return NormalizedSpan; the traces facade denormalizes so React pages do not
 * need a parallel code path.
 */
export function denormalizeSpanToTraceRow(
	span: NormalizedSpan
): Record<string, unknown> {
	const events = (span.events || []).map((ev) => ({
		Name: ev.name,
		Timestamp: ev.timestamp || "",
		Attributes: ev.attributes || {},
	}));
	const spanAttributes = { ...span.spanAttributes };
	if (span.cost !== undefined && spanAttributes["gen_ai.usage.cost"] === undefined) {
		spanAttributes["gen_ai.usage.cost"] = String(span.cost);
	}
	return {
		TraceId: span.traceId,
		SpanId: span.spanId,
		ParentSpanId: span.parentSpanId || "",
		SpanName: span.name,
		ServiceName: span.serviceName,
		Timestamp: span.timestamp,
		Duration: span.durationNs,
		StatusCode: span.statusCode,
		StatusMessage: span.statusMessage || "",
		SpanKind: span.spanKind || "",
		TraceState: "",
		ScopeName: "",
		ScopeVersion: "",
		SpanAttributes: spanAttributes,
		ResourceAttributes: span.resourceAttributes || {},
		Events: events,
		Links: [],
		Cost: span.cost,
	};
}

/** Normalize a raw ClickHouse `otel_traces` row into a NormalizedSpan. */
export function normalizeSpanRow(
	row: Record<string, unknown>
): NormalizedSpan {
	const spanAttributes = asMap(row.SpanAttributes);
	const resourceAttributes = asMap(row.ResourceAttributes);
	const cost =
		row.Cost !== undefined
			? asNumber(row.Cost)
			: spanAttributes["gen_ai.usage.cost"] !== undefined
				? asNumber(spanAttributes["gen_ai.usage.cost"])
				: undefined;

	return {
		traceId: asString(row.TraceId),
		spanId: asString(row.SpanId),
		parentSpanId: asString(row.ParentSpanId),
		name: asString(row.SpanName),
		serviceName: asString(row.ServiceName),
		timestamp: asString(row.Timestamp),
		durationNs: asNumber(row.Duration),
		statusCode: asString(row.StatusCode),
		statusMessage: row.StatusMessage ? asString(row.StatusMessage) : undefined,
		spanKind: row.SpanKind ? asString(row.SpanKind) : undefined,
		spanAttributes,
		resourceAttributes,
		events: normalizeEvents(row),
		cost,
	};
}

/**
 * Convert a NormalizedLog back into the ClickHouse-shaped `otel_logs` row the
 * Logs UI understands (`Timestamp`, `Body`, `SeverityText`, `LogAttributes`, …).
 * External adapters return NormalizedLog; the logs facade denormalizes so the
 * observability pages need no parallel code path. `rowId` is synthesized (see
 * `stableRowId`) since external sources carry no ClickHouse `cityHash64` id.
 */
export function denormalizeLogToClickHouseRow(
	log: NormalizedLog
): Record<string, unknown> {
	const rowId = stableRowId([
		log.timestamp,
		log.traceId || "",
		log.spanId || "",
		log.severityText || "",
		log.body,
	]);
	return {
		rowId,
		Timestamp: log.timestamp,
		TraceId: log.traceId || "",
		SpanId: log.spanId || "",
		SeverityText: log.severityText || "",
		SeverityNumber: log.severityNumber ?? 0,
		Body: log.body,
		ServiceName: log.serviceName || "",
		ScopeName: "",
		ScopeVersion: "",
		LogAttributes: log.logAttributes || {},
		ResourceAttributes: log.resourceAttributes || {},
		ScopeAttributes: log.scopeAttributes || {},
	};
}

/**
 * Aggregate point-level `NormalizedMetricPoint`s into the grouped list rows the
 * Metrics table renders (one row per metricName + serviceName). External metric
 * adapters return points; the metrics facade folds them into the same shape
 * `getMetrics` produces from ClickHouse (`latestValue`/`avgValue`/…).
 */
export function denormalizeMetricPointsToListRows(
	points: NormalizedMetricPoint[]
): Record<string, unknown>[] {
	const groups = new Map<
		string,
		{
			metricName: string;
			serviceName: string;
			description?: string;
			unit?: string;
			values: number[];
			latest: { value: number; ts: number };
			lastSeen: string;
		}
	>();

	for (const p of points) {
		const serviceName = p.serviceName || "";
		const key = `${p.metricName}\u0000${serviceName}`;
		const ts = new Date(p.timestamp).getTime();
		const existing = groups.get(key);
		if (!existing) {
			groups.set(key, {
				metricName: p.metricName,
				serviceName,
				description: p.description,
				unit: p.unit,
				values: [p.value],
				latest: { value: p.value, ts: Number.isFinite(ts) ? ts : 0 },
				lastSeen: p.timestamp,
			});
			continue;
		}
		existing.values.push(p.value);
		if (Number.isFinite(ts) && ts >= existing.latest.ts) {
			existing.latest = { value: p.value, ts };
			existing.lastSeen = p.timestamp;
		}
	}

	return Array.from(groups.values()).map((g) => {
		const count = g.values.length;
		const sum = g.values.reduce((a, b) => a + b, 0);
		return {
			metricName: g.metricName,
			metricType: "gauge",
			serviceName: g.serviceName,
			metricDescription: g.description || "",
			metricUnit: g.unit || "",
			latestValue: g.latest.value,
			avgValue: count ? sum / count : 0,
			minValue: count ? Math.min(...g.values) : 0,
			maxValue: count ? Math.max(...g.values) : 0,
			pointCount: count,
			observationCount: count,
			lastSeen: g.lastSeen,
		};
	});
}

/** Normalize a raw ClickHouse `otel_logs` row into a NormalizedLog. */
export function normalizeLogRow(row: Record<string, unknown>): NormalizedLog {
	return {
		timestamp: asString(row.Timestamp),
		traceId: row.TraceId ? asString(row.TraceId) : undefined,
		spanId: row.SpanId ? asString(row.SpanId) : undefined,
		severityText: row.SeverityText ? asString(row.SeverityText) : undefined,
		severityNumber:
			row.SeverityNumber !== undefined ? asNumber(row.SeverityNumber) : undefined,
		body: asString(row.Body),
		serviceName: row.ServiceName ? asString(row.ServiceName) : undefined,
		logAttributes: asMap(row.LogAttributes),
		resourceAttributes: asMap(row.ResourceAttributes),
		scopeAttributes: row.ScopeAttributes ? asMap(row.ScopeAttributes) : undefined,
	};
}

/**
 * Normalize a raw ClickHouse metric row (from the UNION over the 5 metric
 * tables) into a NormalizedMetricPoint.
 */
export function normalizeMetricRow(
	row: Record<string, unknown>
): NormalizedMetricPoint {
	return {
		metricName: asString(row.MetricName),
		description: row.MetricDescription
			? asString(row.MetricDescription)
			: undefined,
		unit: row.MetricUnit ? asString(row.MetricUnit) : undefined,
		serviceName: row.ServiceName ? asString(row.ServiceName) : undefined,
		timestamp: asString(row.TimeUnix ?? row.Timestamp),
		value: asNumber(row.Value),
		attributes: asMap(row.Attributes),
		resourceAttributes: asMap(row.ResourceAttributes),
	};
}
