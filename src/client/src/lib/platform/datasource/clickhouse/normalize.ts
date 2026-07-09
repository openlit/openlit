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
