import type {
	Aggregation,
	AggregationFn,
	DataFrame,
	NormalizedSpan,
} from "../types";

const TOKEN_ATTR_KEYS = [
	"gen_ai.usage.total_tokens",
	"gen_ai.client.token.usage",
	"total_tokens",
] as const;

const COST_ATTR_KEYS = ["gen_ai.usage.cost", "coding_agent.session.cost_usd"] as const;

const ROOT_PARENT_IDS = new Set(["", "0".repeat(16)]);

function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return undefined;
}

function lookupAttr(
	attrs: Record<string, string>,
	keys: readonly string[]
): string | undefined {
	for (const key of keys) {
		const v = attrs[key];
		if (v !== undefined && v !== "") return v;
	}
	return undefined;
}

/** Resolve a numeric or string field from a normalized span for aggregation/groupBy. */
export function spanFieldValue(
	span: NormalizedSpan,
	field: string
): number | string | undefined {
	const f = field.trim();
	if (!f) return undefined;
	const lower = f.toLowerCase();

	if (
		lower === "duration" ||
		f === "Duration" ||
		f === "requestDuration"
	) {
		return (span.durationNs || 0) / 1e9;
	}
	if (f === "durationNs") return span.durationNs;

	if (lower === "cost" || COST_ATTR_KEYS.includes(f as (typeof COST_ATTR_KEYS)[number])) {
		if (typeof span.cost === "number" && Number.isFinite(span.cost)) {
			return span.cost;
		}
		const raw =
			span.spanAttributes[f] ??
			lookupAttr(span.spanAttributes, COST_ATTR_KEYS) ??
			span.resourceAttributes[f];
		return asNumber(raw);
	}

	if (
		lower === "tokens" ||
		lower === "totaltokens" ||
		lower === "total_tokens" ||
		TOKEN_ATTR_KEYS.includes(f as (typeof TOKEN_ATTR_KEYS)[number])
	) {
		const raw =
			span.spanAttributes[f] ??
			lookupAttr(span.spanAttributes, TOKEN_ATTR_KEYS) ??
			span.resourceAttributes[f];
		return asNumber(raw);
	}

	if (f === "SpanName" || f === "spanName" || f === "name") return span.name;
	if (
		f === "ServiceName" ||
		f === "serviceName" ||
		f === "service.name"
	) {
		return span.serviceName || span.resourceAttributes["service.name"];
	}
	if (f === "StatusCode" || f === "statusCode") return span.statusCode;
	if (f === "TraceId" || f === "traceId") return span.traceId;
	if (f === "SpanId" || f === "spanId") return span.spanId;
	if (f === "ParentSpanId" || f === "parentSpanId") return span.parentSpanId;

	if (Object.prototype.hasOwnProperty.call(span.spanAttributes, f)) {
		return span.spanAttributes[f];
	}
	if (Object.prototype.hasOwnProperty.call(span.resourceAttributes, f)) {
		return span.resourceAttributes[f];
	}

	return undefined;
}

type IntervalUnit = "minute" | "hour" | "day" | "month";

function parseIntervalUnit(interval: string): IntervalUnit {
	const trimmed = (interval || "1h").trim();
	// Month uses capital M ("1M"); lowercase "1m" means minute.
	if (trimmed === "month" || /^[0-9]+M$/.test(trimmed)) return "month";
	const raw = trimmed.toLowerCase();
	if (raw === "day" || /^[0-9]+d$/.test(raw)) return "day";
	if (raw === "hour" || /^[0-9]+h$/.test(raw)) return "hour";
	if (raw === "minute" || raw === "m" || /^[0-9]+m$/.test(raw)) return "minute";
	return "hour";
}

function truncateToBucket(date: Date, unit: IntervalUnit): Date {
	const d = new Date(date.getTime());
	d.setUTCMilliseconds(0);
	d.setUTCSeconds(0);
	if (unit === "minute") return d;
	d.setUTCMinutes(0);
	if (unit === "hour") return d;
	d.setUTCHours(0);
	if (unit === "day") return d;
	d.setUTCDate(1);
	return d;
}

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function formatBucketLabel(bucket: Date, unit: IntervalUnit): string {
	const y = bucket.getUTCFullYear();
	const mo = pad2(bucket.getUTCMonth() + 1);
	const day = pad2(bucket.getUTCDate());
	const h = pad2(bucket.getUTCHours());
	if (unit === "month") return `${y}/${mo}`;
	if (unit === "day") return `${y}/${mo}/${day}`;
	if (unit === "hour") return `${mo}/${day} ${h}:00`;
	return `${mo}/${day} ${h}:${pad2(bucket.getUTCMinutes())}`;
}

function aggAlias(agg: Aggregation, index: number): string {
	return agg.as || `agg${index}`;
}

function percentile(sorted: number[], q: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(
		sorted.length - 1,
		Math.max(0, Math.floor(q * (sorted.length - 1)))
	);
	return sorted[idx];
}

function collectFieldNumbers(
	spans: NormalizedSpan[],
	field: string | undefined
): number[] {
	if (!field) return [];
	const out: number[] = [];
	for (const span of spans) {
		const v = asNumber(spanFieldValue(span, field));
		if (v !== undefined) out.push(v);
	}
	return out;
}

function applyAggregation(
	spans: NormalizedSpan[],
	agg: Aggregation
): number {
	const fn: AggregationFn = agg.fn;
	if (fn === "count") return spans.length;

	if (fn === "cardinality") {
		const seen = new Set<string>();
		for (const span of spans) {
			const v = spanFieldValue(span, agg.field || "");
			if (v === undefined || v === "") continue;
			seen.add(String(v));
		}
		return seen.size;
	}

	const values = collectFieldNumbers(spans, agg.field);
	if (values.length === 0) return 0;

	switch (fn) {
		case "sum":
			return values.reduce((a, b) => a + b, 0);
		case "avg":
			return values.reduce((a, b) => a + b, 0) / values.length;
		case "min":
			return Math.min(...values);
		case "max":
			return Math.max(...values);
		case "p50":
			return percentile(values.slice().sort((a, b) => a - b), 0.5);
		case "p90":
			return percentile(values.slice().sort((a, b) => a - b), 0.9);
		case "p95":
			return percentile(values.slice().sort((a, b) => a - b), 0.95);
		case "p99":
			return percentile(values.slice().sort((a, b) => a - b), 0.99);
		default:
			return 0;
	}
}

function applyAggregations(
	spans: NormalizedSpan[],
	aggregations: Aggregation[]
): Record<string, number> {
	const aggs =
		aggregations.length > 0 ? aggregations : [{ fn: "count" as const }];
	const row: Record<string, number> = {};
	aggs.forEach((agg, i) => {
		row[aggAlias(agg, i)] = applyAggregation(spans, agg);
	});
	return row;
}

function parseSpanTime(span: NormalizedSpan): Date | null {
	if (!span.timestamp) return null;
	const d = new Date(span.timestamp);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** Bucket spans by interval and compute aggregations per bucket. */
export function bucketSpansByInterval(
	spans: NormalizedSpan[],
	interval: string,
	aggregations: Aggregation[],
	timeRange?: { start: Date; end: Date }
): DataFrame {
	const unit = parseIntervalUnit(interval);
	const byBucket = new Map<number, NormalizedSpan[]>();

	for (const span of spans) {
		const t = parseSpanTime(span);
		if (!t) continue;
		const bucket = truncateToBucket(t, unit);
		const key = bucket.getTime();
		const list = byBucket.get(key) || [];
		list.push(span);
		byBucket.set(key, list);
	}

	let keys = Array.from(byBucket.keys()).sort((a, b) => a - b);

	// Zero-fill across the requested window so charts aren't a single spike
	// when the L1 sample lands in one bucket.
	if (timeRange?.start && timeRange?.end) {
		const startKey = truncateToBucket(timeRange.start, unit).getTime();
		const endKey = truncateToBucket(timeRange.end, unit).getTime();
		const filled: number[] = [];
		const stepMs =
			unit === "minute"
				? 60_000
				: unit === "hour"
					? 3_600_000
					: unit === "day"
						? 86_400_000
						: 0;
		const MAX_BUCKETS = 168; // 7d hourly
		if (stepMs > 0) {
			for (
				let t = startKey;
				t <= endKey && filled.length < MAX_BUCKETS;
				t += stepMs
			) {
				filled.push(t);
			}
			keys = filled;
		} else {
			// Month: walk calendar months
			const cursor = new Date(startKey);
			while (cursor.getTime() <= endKey && filled.length < MAX_BUCKETS) {
				filled.push(cursor.getTime());
				cursor.setUTCMonth(cursor.getUTCMonth() + 1);
			}
			keys = filled;
		}
	}

	const emptyAggs = applyAggregations([], aggregations);
	const rows = keys.map((key) => {
		const bucketDate = new Date(key);
		const iso = bucketDate.toISOString();
		const groupSpans = byBucket.get(key) || [];
		return {
			bucket: iso,
			label: formatBucketLabel(bucketDate, unit),
			request_time: iso,
			...(groupSpans.length
				? applyAggregations(groupSpans, aggregations)
				: emptyAggs),
		};
	});

	return { fields: [], rows };
}

function groupKeyValue(span: NormalizedSpan, key: string): string {
	const v = spanFieldValue(span, key);
	if (v === undefined || v === null) return "";
	return String(v);
}

/** Group spans and compute aggregations in-process. */
export function aggregateSpansInProcess(
	spans: NormalizedSpan[],
	groupBy: string[],
	aggregations: Aggregation[]
): DataFrame {
	const keys = (groupBy || []).filter(Boolean);

	if (keys.length === 0) {
		return {
			fields: [],
			rows: [applyAggregations(spans, aggregations)],
		};
	}

	const groups = new Map<string, NormalizedSpan[]>();
	for (const span of spans) {
		const parts = keys.map((k) => groupKeyValue(span, k));
		const key = parts.join("\u0000");
		const list = groups.get(key) || [];
		list.push(span);
		groups.set(key, list);
	}

	const rows = Array.from(groups.entries()).map(([composite, groupSpans]) => {
		const parts = composite.split("\u0000");
		const row: Record<string, unknown> = {
			...applyAggregations(groupSpans, aggregations),
			group_value: parts[0] ?? "",
		};
		keys.forEach((k, i) => {
			row[k] = parts[i] ?? "";
		});
		return row;
	});

	return { fields: [], rows };
}

/** Distinct non-empty values for an attribute / service.name / SpanName key. */
export function distinctFromSpans(
	spans: NormalizedSpan[],
	key: string
): string[] {
	const seen = new Set<string>();
	for (const span of spans) {
		const v = spanFieldValue(span, key);
		if (v === undefined || v === null || v === "") continue;
		seen.add(String(v));
	}
	return Array.from(seen).sort();
}

/** True when rows look like one root span per trace (listSpans Explore shape). */
export function looksLikeRootsOnly(spans: NormalizedSpan[]): boolean {
	if (spans.length === 0) return false;
	const traceIds = new Set<string>();
	for (const span of spans) {
		if (span.traceId) traceIds.add(span.traceId);
		const parent = span.parentSpanId || "";
		if (parent && !ROOT_PARENT_IDS.has(parent)) return false;
	}
	return traceIds.size === spans.length;
}
