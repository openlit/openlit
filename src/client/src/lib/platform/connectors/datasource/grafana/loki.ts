import { AdapterError } from "@openplait/adapter-sdk";
import { LokiAdapter as OpenPlaitLokiAdapter } from "@openplait/adapter-loki";
import { OpenPlaitHttpAdapter } from "./openplait-http";
import type {
	DataFrame,
	HealthCheckResult,
	NormalizedLog,
	OpenLITQuery,
	QueryTimeRange,
	Signal,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { openPlaitFramesToRows } from "@/lib/platform/openplait/frames";
import { logStableRowId } from "@/lib/platform/connectors/datasource/clickhouse/normalize";
import { computeIntervalMs, intervalMsToLabel } from "../downsample";
import { httpVendorFields } from "../config-fields";
import { SourceResponseError } from "../http/safe-fetch";
import getMessage from "@/constants/messages";

/** Loki's default `max_query_length` is typically 30d1h (~721h). */
const DEFAULT_MAX_QUERY_RANGE_MS = 30 * 24 * 60 * 60 * 1_000;
/** Cap how many log row ids we remember for list → detail lookups. */
const LOG_INDEX_MAX = 5_000;
/** Recent-window fallback when a detail link misses the warm index. */
const GET_LOG_FALLBACK_RANGE_MS = 24 * 60 * 60 * 1_000;
/** When a list row supplies Timestamp, search a tight window around it. */
const GET_LOG_AROUND_PAD_MS = 60 * 60 * 1_000;
const GET_LOG_FALLBACK_LIMIT = 500;
const GET_LOG_AROUND_LIMIT = 2_000;
const learnedQueryRangeBySource = new Map<string, number>();

/**
 * Process-wide log index so Telemetry list → detail works across separate HTTP
 * handlers in the same Node process (adapters are constructed per request).
 */
const logIndexBySource = new Map<string, Map<string, NormalizedLog>>();

function rememberLogs(sourceId: string, logs: NormalizedLog[]) {
	let map = logIndexBySource.get(sourceId);
	if (!map) {
		map = new Map();
		logIndexBySource.set(sourceId, map);
	}
	for (const log of logs) {
		const rowId = logStableRowId(log);
		if (map.size >= LOG_INDEX_MAX && !map.has(rowId)) {
			const oldest = map.keys().next().value;
			if (oldest) map.delete(oldest);
		}
		map.set(rowId, log);
	}
}

function lookupIndexedLog(
	sourceId: string,
	logId: string
): NormalizedLog | undefined {
	return logIndexBySource.get(sourceId)?.get(logId);
}

/** Test-only: clear the process-wide Loki log index / learned limits. */
export function __resetLokiLearningForTests() {
	learnedQueryRangeBySource.clear();
	logIndexBySource.clear();
}

const LABELS: Record<string, string> = {
	"service.name": "service_name",
	serviceName: "service_name",
	"trace.id": "trace_id",
	traceId: "trace_id",
	"span.id": "span_id",
	spanId: "span_id",
	severity: "level",
	severityText: "level",
	job: "job",
	instance: "instance",
};

function escape(value: string): string {
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/[\r\n\0]/g, " ")}"`;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelName(key: string): string {
	const mapped = LABELS[key] || key;
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(mapped)
		? mapped
		: mapped.replace(/[^A-Za-z0-9_]/g, "_");
}

function filterValues(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : [value];
	return raw
		.filter((item) => item !== undefined && item !== null && String(item) !== "")
		.map(String);
}

function selector(query: OpenLITQuery, fallback: string): string {
	const labels: string[] = [];
	const lines: string[] = [];
	for (const filter of query.filters || []) {
		const values = filterValues(filter.value);
		if (
			filter.target === "spanName" ||
			(filter.target === "attribute" &&
				(filter.key === "body" || filter.key === "message"))
		) {
			for (const value of values) {
				lines.push(
					`${
						filter.op === "neq" || filter.op === "notIn"
							? "!="
							: "|="
					} ${escape(value)}`
				);
			}
			continue;
		}
		if (filter.target !== "attribute" || !filter.key || values.length === 0) {
			continue;
		}
		const negative = filter.op === "neq" || filter.op === "notIn";
		if (filter.op === "contains") {
			labels.push(
				`${labelName(filter.key)}=~${escape(`.*${escapeRegex(values[0])}.*`)}`
			);
			continue;
		}
		if (values.length === 1 && filter.op !== "in" && filter.op !== "notIn") {
			labels.push(
				`${labelName(filter.key)}${negative ? "!=" : "="}${escape(values[0])}`
			);
			continue;
		}
		labels.push(
			`${labelName(filter.key)}${negative ? "!~" : "=~"}${escape(
				values.map(escapeRegex).join("|")
			)}`
		);
	}
	const base = labels.length ? `{${labels.join(",")}}` : fallback;
	return `${base}${lines.length ? ` ${lines.join(" ")}` : ""}`;
}

/** Parse Loki/Go-style durations such as `30d1h`, `721h`, or `24h0m0s`. */
export function parseLokiDurationMs(value: string): number | undefined {
	let total = 0;
	let matched = 0;
	const unitMs: Record<string, number> = {
		w: 7 * 24 * 60 * 60 * 1_000,
		d: 24 * 60 * 60 * 1_000,
		h: 60 * 60 * 1_000,
		m: 60 * 1_000,
		s: 1_000,
		ms: 1,
	};
	const expression = /(\d+(?:\.\d+)?)(ms|w|d|h|m|s)/g;
	let match: RegExpExecArray | null;
	while ((match = expression.exec(value)) !== null) {
		total += Number(match[1]) * unitMs[match[2]];
		matched += match[0].length;
	}
	return matched === value.replace(/\s+/g, "").length && total > 0
		? total
		: undefined;
}

/** Extract Loki's reported max query length from an HTTP 400 body. */
export function reportedLokiMaxQueryRangeMs(body: string): number | undefined {
	const match = body.match(
		/query time range exceeds the limit[^\n]*limit:\s*([0-9a-z.]+)/i
	);
	if (!match?.[1]) return undefined;
	return parseLokiDurationMs(match[1]);
}

function adapterErrorBody(error: unknown): string {
	if (error instanceof AdapterError) {
		const body = error.details?.body;
		if (typeof body === "string") return body;
	}
	return error instanceof Error ? error.message : "";
}

function clampTimeRange(
	range: QueryTimeRange,
	maxMs: number
): QueryTimeRange {
	const end = range.end.getTime();
	const start = range.start.getTime();
	if (!Number.isFinite(end) || !Number.isFinite(start) || end < start) {
		return range;
	}
	if (end - start <= maxMs) return range;
	return { start: new Date(end - maxMs), end: range.end };
}

export class LokiAdapter extends OpenPlaitHttpAdapter {
	readonly type = "loki";

	constructor(descriptor: TelemetrySourceDescriptor) {
		super(descriptor);
	}

	private get defaultSelector(): string {
		const value = String(this.descriptor.settings.defaultSelector || "").trim();
		return /^\{.+\}$/.test(value) ? value : '{service_name=~".+"}';
	}

	private get configuredMaxTimeRangeMs(): number | undefined {
		const value = Number(this.descriptor.settings.maxTimeRangeMs);
		return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
	}

	private get maxQueryRangeMs(): number {
		const configured = this.configuredMaxTimeRangeMs;
		const learned = learnedQueryRangeBySource.get(this.descriptor.id);
		const candidates = [
			configured,
			learned,
			configured === undefined && learned === undefined
				? DEFAULT_MAX_QUERY_RANGE_MS
				: undefined,
		].filter((value): value is number => value !== undefined && value > 0);
		return Math.min(...candidates);
	}

	private async adapter(): Promise<OpenPlaitLokiAdapter> {
		const connection = await this.openPlaitConnection();
		return new OpenPlaitLokiAdapter(
			{
				url: this.baseUrl,
				httpHeaders: connection.headers,
				allowNativeQueries: true,
				maxResultRows: this.positiveSetting("maxResultRows") || 5_000,
				// OpenPlait rejects oversized ranges; OpenLIT clamps first so we
				// do not also set maxTimeRangeMs here.
				maxLookbackMs: this.positiveSetting("maxLookbackMs"),
			},
			{ fetch: connection.fetch }
		);
	}

	capabilities(): SourceCapabilities {
		return {
			signals: ["logs"],
			traceTree: false,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			maxLookbackMs: this.positiveSetting("maxLookbackMs"),
			maxTimeRangeMs: this.maxQueryRangeMs,
			rawQuery: false,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const started = Date.now();
		try {
			await (await this.adapter()).labelNames({ timeoutMs: 10_000 });
			return { ok: true, latencyMs: Date.now() - started };
		} catch (error) {
			return {
				ok: false,
				latencyMs: Date.now() - started,
				message: String((error as Error)?.message || error),
			};
		}
	}

	private range(query: OpenLITQuery): { from: string; to: string } {
		const clamped = clampTimeRange(query.timeRange, this.maxQueryRangeMs);
		return {
			from: clamped.start.toISOString(),
			to: clamped.end.toISOString(),
		};
	}

	private clampedQuery(query: OpenLITQuery): OpenLITQuery {
		const timeRange = clampTimeRange(query.timeRange, this.maxQueryRangeMs);
		return timeRange === query.timeRange ? query : { ...query, timeRange };
	}

	private async withRangeRetry<T>(
		query: OpenLITQuery,
		run: (query: OpenLITQuery) => Promise<T>
	): Promise<T> {
		const effective = this.clampedQuery(query);
		try {
			return await run(effective);
		} catch (error) {
			const body = adapterErrorBody(error);
			const reported = reportedLokiMaxQueryRangeMs(body);
			const rangeMs =
				effective.timeRange.end.getTime() - effective.timeRange.start.getTime();
			const status =
				error instanceof AdapterError
					? error.details?.status
					: error instanceof SourceResponseError
						? error.status
						: typeof (error as { status?: unknown })?.status === "number"
							? (error as { status: number }).status
							: undefined;
			if (status === 400 && reported !== undefined && rangeMs > reported) {
				learnedQueryRangeBySource.set(this.descriptor.id, reported);
				const retried = this.clampedQuery(query);
				return run(retried);
			}
			throw error;
		}
	}

	async listLogs(query: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		return this.withRangeRetry(query, async (effective) => {
			const result = await this.executeNative(await this.adapter(), {
				operation: "list-logs",
				kind: "LokiDatasource",
				language: "logql",
				statement: selector(effective, this.defaultSelector),
				extension: "io.openplait.loki",
				extensionValue: {
					timeRange: this.range(effective),
					limit: effective.limit || 500,
					direction:
						effective.sort?.[0]?.direction === "asc" ? "forward" : "backward",
				},
			});
			const rows = openPlaitFramesToRows(result.frames).map((row) => {
				const labels = (row.labels || {}) as Record<string, string>;
				return {
					timestamp: String(row.timestamp),
					body: String(row.body || ""),
					traceId: labels.trace_id,
					spanId: labels.span_id,
					severityText: labels.level,
					serviceName: labels.service_name || labels.service,
					logAttributes: labels,
					resourceAttributes: labels,
				} satisfies NormalizedLog;
			});
			rememberLogs(this.descriptor.id, rows);
			return {
				fields: [
					{ name: "timestamp", type: "time" },
					{ name: "body", type: "string" },
					{ name: "logAttributes", type: "map" },
				],
				rows,
				meta: {
					latencyMs: result.metadata?.executionTimeMs,
					freshness: "live",
				},
			};
		});
	}

	async getLog(
		logId: string,
		opts?: { aroundTimestamp?: string | Date; timeRange?: QueryTimeRange }
	): Promise<NormalizedLog | null> {
		const id = String(logId || "").trim();
		if (!id) return null;
		const cached = lookupIndexedLog(this.descriptor.id, id);
		if (cached) return cached;

		let start: Date;
		let end: Date;
		let limit = GET_LOG_FALLBACK_LIMIT;
		if (opts?.timeRange?.start && opts?.timeRange?.end) {
			start = new Date(opts.timeRange.start);
			end = new Date(opts.timeRange.end);
			limit = GET_LOG_AROUND_LIMIT;
		} else if (opts?.aroundTimestamp) {
			const center = new Date(opts.aroundTimestamp);
			if (!Number.isNaN(center.getTime())) {
				start = new Date(center.getTime() - GET_LOG_AROUND_PAD_MS);
				end = new Date(center.getTime() + GET_LOG_AROUND_PAD_MS);
				limit = GET_LOG_AROUND_LIMIT;
			} else {
				end = new Date();
				start = new Date(end.getTime() - GET_LOG_FALLBACK_RANGE_MS);
			}
		} else {
			end = new Date();
			start = new Date(end.getTime() - Math.min(this.maxQueryRangeMs, 7 * 24 * 60 * 60 * 1_000));
			limit = GET_LOG_AROUND_LIMIT;
		}

		const frame = await this.listLogs({
			signal: "logs",
			timeRange: { start, end },
			limit,
			sort: [{ field: "timestamp", direction: "desc" }],
		});
		return (
			frame.rows.find((row) => logStableRowId(row) === id) ||
			lookupIndexedLog(this.descriptor.id, id) ||
			null
		);
	}

	async logTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		return this.withRangeRetry(query, async (effective) => {
			const started = Date.now();
			const stepMs = computeIntervalMs(effective);
			const step = intervalMsToLabel(stepMs);
			const stepSeconds = Math.max(1, Math.round(stepMs / 1000));
			// OpenPlait's Loki adapter does not yet forward `step`, which Loki
			// requires for metric query_range — call the API directly.
			const statement = `sum(count_over_time(${selector(effective, this.defaultSelector)}[${step}]))`;
			const range = this.range(effective);
			const connection = await this.openPlaitConnection();
			const url = new URL("loki/api/v1/query_range", `${this.baseUrl}/`);
			url.searchParams.set("query", statement);
			url.searchParams.set(
				"start",
				`${new Date(range.from).getTime()}000000`
			);
			url.searchParams.set("end", `${new Date(range.to).getTime()}000000`);
			url.searchParams.set("step", String(stepSeconds));
			const response = await connection.fetch(url.toString(), {
				headers: connection.headers,
			});
			if (!response.ok) {
				throw new SourceResponseError(
					response.status,
					await response.text()
				);
			}
			const body = (await response.json()) as {
				data?: {
					result?: Array<{ values?: Array<[number | string, string]> }>;
				};
			};
			const rows: Record<string, unknown>[] = [];
			for (const series of body.data?.result || []) {
				for (const sample of series.values || []) {
					const raw = Number(sample[0]);
					if (!Number.isFinite(raw)) continue;
					const timestampMs =
						raw > 10_000_000_000_000 ? raw / 1_000_000 : raw * 1_000;
					const timestamp = new Date(timestampMs).toISOString();
					const count = Number(sample[1]) || 0;
					rows.push({
						timestamp,
						value: count,
						label: timestamp,
						count,
					});
				}
			}
			return {
				fields: [
					{ name: "timestamp", type: "time" },
					{ name: "value", type: "number" },
					{ name: "label", type: "string" },
					{ name: "count", type: "number" },
				],
				rows,
				meta: {
					latencyMs: Date.now() - started,
					freshness: "live",
				},
			};
		});
	}

	async attributeKeys(signal: Signal, window: QueryTimeRange): Promise<string[]> {
		if (signal !== "logs") return [];
		return this.discoverLabelValues("loki/api/v1/labels", window);
	}

	async distinctValues(key: string, query: OpenLITQuery): Promise<string[]> {
		const label = labelName(key);
		return this.discoverLabelValues(
			`loki/api/v1/label/${encodeURIComponent(label)}/values`,
			query.timeRange
		);
	}

	/**
	 * Loki's labels APIs return an empty `data` payload unless `start`/`end`
	 * are supplied (nanoseconds). OpenPlait's discovery helpers do not yet
	 * pass a window, so OpenLIT queries the label endpoints directly with the
	 * clamped UI time range.
	 */
	private async discoverLabelValues(
		path: string,
		window: QueryTimeRange
	): Promise<string[]> {
		const connection = await this.openPlaitConnection();
		const clamped = clampTimeRange(window, this.maxQueryRangeMs);
		const url = new URL(path, `${this.baseUrl}/`);
		url.searchParams.set("start", `${clamped.start.getTime()}000000`);
		url.searchParams.set("end", `${clamped.end.getTime()}000000`);
		const response = await connection.fetch(url.toString(), {
			headers: connection.headers,
		});
		if (!response.ok) return [];
		const body = (await response.json()) as { data?: unknown };
		return Array.isArray(body.data)
			? body.data.filter((item): item is string => typeof item === "string")
			: [];
	}
}

export const lokiAdapterFactory = {
	type: "loki",
	create: (descriptor: TelemetrySourceDescriptor) => new LokiAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "loki",
		displayName: "Grafana Loki",
		description: "Logs from a Loki-compatible query API.",
		declaredSignals: ["logs"],
		capabilities: {
			traceTree: false,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: false,
			maxTimeRangeMs: DEFAULT_MAX_QUERY_RANGE_MS,
		},
		correlation: { crossSignal: true, keys: ["traceId", "spanId", "service"] },
		configFields: [
			...httpVendorFields({
				placeholder: "http://localhost:3100",
				tenant: true,
			}),
			{
				key: "defaultSelector",
				label: "Default LogQL stream selector",
				kind: "text",
				group: "settings",
				placeholder: '{service_name=~".+"}',
			},
			{
				key: "maxTimeRangeMs",
				label: "Maximum query range (ms)",
				kind: "text",
				group: "settings",
				placeholder: String(DEFAULT_MAX_QUERY_RANGE_MS),
			},
		],
		authStyle: "http",
		authHelp: getMessage().DATA_SOURCE_AUTH_HELP_HTTP,
	}),
};
