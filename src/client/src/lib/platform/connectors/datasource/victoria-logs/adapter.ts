import { OpenPlaitHttpAdapter } from "../grafana/openplait-http";
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
import { logStableRowId } from "@/lib/platform/connectors/datasource/clickhouse/normalize";
import { computeIntervalMs, intervalMsToLabel } from "../downsample";
import { httpVendorFields } from "../config-fields";
import { SourceResponseError } from "../http/safe-fetch";
import getMessage from "@/constants/messages";
import { victoriaLogsFieldName, victoriaLogsSelector } from "./selector";

const DEFAULT_MAX_QUERY_RANGE_MS = 30 * 24 * 60 * 60 * 1_000;
const LOG_INDEX_MAX = 5_000;
const GET_LOG_FALLBACK_RANGE_MS = 24 * 60 * 60 * 1_000;
const GET_LOG_AROUND_PAD_MS = 60 * 60 * 1_000;
const GET_LOG_FALLBACK_LIMIT = 500;
const GET_LOG_AROUND_LIMIT = 2_000;
const DEFAULT_SELECTOR = "*";

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

/** Test-only: clear the process-wide VictoriaLogs log index. */
export function __resetVictoriaLogsForTests() {
	logIndexBySource.clear();
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

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringField(row: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = row[key];
		if (value !== undefined && value !== null && String(value) !== "") {
			return String(value);
		}
	}
	return undefined;
}

function parseNdjson(payload: unknown): Record<string, unknown>[] {
	if (Array.isArray(payload)) {
		return payload.filter(
			(item): item is Record<string, unknown> =>
				!!item && typeof item === "object" && !Array.isArray(item)
		);
	}
	const text =
		typeof payload === "string"
			? payload
			: payload == null
				? ""
				: JSON.stringify(payload);
	const rows: Record<string, unknown>[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				rows.push(parsed as Record<string, unknown>);
			}
		} catch {
			// Skip malformed NDJSON lines.
		}
	}
	return rows;
}

function normalizeLog(row: Record<string, unknown>): NormalizedLog {
	const labels: Record<string, string> = {};
	for (const [key, value] of Object.entries(row)) {
		if (value === undefined || value === null) continue;
		if (typeof value === "object") continue;
		labels[key] = String(value);
	}
	return {
		timestamp: stringField(row, "_time", "timestamp") || new Date().toISOString(),
		body: stringField(row, "_msg", "body", "message") || "",
		traceId: stringField(row, "trace_id", "traceId"),
		spanId: stringField(row, "span_id", "spanId"),
		severityText: stringField(row, "level", "severity", "severityText"),
		serviceName: stringField(row, "service_name", "service"),
		logAttributes: labels,
		resourceAttributes: labels,
	};
}

function fieldValuesFrom(payload: unknown): string[] {
	const body = asRecord(payload);
	const values = body.values;
	if (!Array.isArray(values)) return [];
	return values
		.map((item) => {
			if (typeof item === "string") return item;
			const record = asRecord(item);
			return typeof record.value === "string" ? record.value : "";
		})
		.filter((item) => item.length > 0);
}

export class VictoriaLogsAdapter extends OpenPlaitHttpAdapter {
	readonly type = "victorialogs";

	protected tenantHeader(): "X-Scope-OrgID" | "AccountID" {
		return "AccountID";
	}

	private get defaultSelector(): string {
		const value = String(this.descriptor.settings.defaultSelector || "").trim();
		return value || DEFAULT_SELECTOR;
	}

	private get maxQueryRangeMs(): number {
		return this.positiveSetting("maxTimeRangeMs") || DEFAULT_MAX_QUERY_RANGE_MS;
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
			const connection = await this.openPlaitConnection();
			const url = new URL("health", `${this.baseUrl}/`);
			const response = await connection.fetch(url.toString(), {
				headers: connection.headers,
			});
			if (!response.ok) {
				throw new SourceResponseError(response.status, await response.text());
			}
			return { ok: true, latencyMs: Date.now() - started };
		} catch (error) {
			return {
				ok: false,
				latencyMs: Date.now() - started,
				message: String((error as Error)?.message || error),
			};
		}
	}

	private clampedRange(range: QueryTimeRange): QueryTimeRange {
		return clampTimeRange(range, this.maxQueryRangeMs);
	}

	private async postForm(
		path: string,
		fields: Record<string, string>
	): Promise<unknown> {
		const connection = await this.openPlaitConnection();
		const url = new URL(path, `${this.baseUrl}/`);
		const body = new URLSearchParams(fields).toString();
		const response = await connection.fetch(url.toString(), {
			method: "POST",
			headers: {
				...connection.headers,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body,
		});
		if (!response.ok) {
			throw new SourceResponseError(response.status, await response.text());
		}
		return response.json();
	}

	async listLogs(query: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		const started = Date.now();
		const range = this.clampedRange(query.timeRange);
		const payload = await this.postForm("select/logsql/query", {
			query: victoriaLogsSelector(query, this.defaultSelector),
			start: range.start.toISOString(),
			end: range.end.toISOString(),
			limit: String(query.limit || 500),
		});
		const rows = parseNdjson(payload).map(normalizeLog);
		rememberLogs(this.descriptor.id, rows);
		return {
			fields: [
				{ name: "timestamp", type: "time" },
				{ name: "body", type: "string" },
				{ name: "logAttributes", type: "map" },
			],
			rows,
			meta: { latencyMs: Date.now() - started, freshness: "live" },
		};
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
			start = new Date(
				end.getTime() - Math.min(this.maxQueryRangeMs, 7 * 24 * 60 * 60 * 1_000)
			);
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
		const started = Date.now();
		const range = this.clampedRange(query.timeRange);
		const step = intervalMsToLabel(computeIntervalMs(query));
		const payload = asRecord(
			await this.postForm("select/logsql/hits", {
				query: victoriaLogsSelector(query, this.defaultSelector),
				start: range.start.toISOString(),
				end: range.end.toISOString(),
				step,
			})
		);
		const hits = Array.isArray(payload.hits) ? payload.hits : [];
		const rows: Record<string, unknown>[] = [];
		for (const series of hits) {
			const item = asRecord(series);
			const timestamps = Array.isArray(item.timestamps) ? item.timestamps : [];
			const values = Array.isArray(item.values) ? item.values : [];
			for (let i = 0; i < timestamps.length; i++) {
				const timestamp = String(timestamps[i] || "");
				const count = Number(values[i]) || 0;
				rows.push({ timestamp, value: count, label: timestamp, count });
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
			meta: { latencyMs: Date.now() - started, freshness: "live" },
		};
	}

	async attributeKeys(signal: Signal, window: QueryTimeRange): Promise<string[]> {
		if (signal !== "logs") return [];
		const range = this.clampedRange(window);
		const payload = await this.postForm("select/logsql/field_names", {
			query: this.defaultSelector,
			start: range.start.toISOString(),
			end: range.end.toISOString(),
		});
		return fieldValuesFrom(payload);
	}

	async distinctValues(key: string, query: OpenLITQuery): Promise<string[]> {
		const range = this.clampedRange(query.timeRange);
		const payload = await this.postForm("select/logsql/field_values", {
			query: victoriaLogsSelector(query, this.defaultSelector),
			field: victoriaLogsFieldName(key),
			start: range.start.toISOString(),
			end: range.end.toISOString(),
		});
		return fieldValuesFrom(payload);
	}
}

export const victoriaLogsAdapterFactory = {
	type: "victorialogs",
	create: (descriptor: TelemetrySourceDescriptor) =>
		new VictoriaLogsAdapter(descriptor),
	describe: (): SourceTypeDescriptor => {
		const messages = getMessage();
		return {
			type: "victorialogs",
			displayName: messages.DATA_SOURCE_TYPE_VICTORIALOGS,
			description: messages.DATA_SOURCE_TYPE_VICTORIALOGS_DESCRIPTION,
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
					placeholder: "http://localhost:9428",
					tenant: true,
				}),
				{
					key: "tenantProject",
					label: messages.DATA_SOURCE_FIELD_TENANT_PROJECT,
					kind: "text",
					group: "settings",
					placeholder: messages.DATA_SOURCE_FIELD_TENANT_PROJECT_PLACEHOLDER,
					description: messages.DATA_SOURCE_FIELD_TENANT_PROJECT_HELP,
				},
				{
					key: "defaultSelector",
					label: messages.DATA_SOURCE_FIELD_DEFAULT_SELECTOR,
					kind: "text",
					group: "settings",
					placeholder: DEFAULT_SELECTOR,
				},
				{
					key: "maxTimeRangeMs",
					label: messages.DATA_SOURCE_FIELD_MAX_TIME_RANGE_MS,
					kind: "text",
					group: "settings",
					placeholder: String(DEFAULT_MAX_QUERY_RANGE_MS),
				},
			],
			authStyle: "http",
			authHelp: messages.DATA_SOURCE_AUTH_HELP_HTTP,
			docsUrl: messages.DATA_SOURCE_SETUP_GUIDES.victorialogs.docsUrl,
		};
	},
};
