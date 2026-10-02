import { VictoriaLogsAdapter as OpenPlaitVictoriaLogsAdapter } from "@openplait/adapter-victorialogs";
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
import { openPlaitFramesToRows } from "@/lib/platform/openplait/frames";
import { logStableRowId } from "@/lib/platform/connectors/datasource/clickhouse/normalize";
import { computeIntervalMs, intervalMsToLabel } from "../downsample";
import { httpVendorFields } from "../config-fields";
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

	private async adapter(): Promise<OpenPlaitVictoriaLogsAdapter> {
		const connection = await this.openPlaitConnection();
		return new OpenPlaitVictoriaLogsAdapter(
			{
				url: this.baseUrl,
				httpHeaders: connection.headers,
				allowNativeQueries: true,
				maxResultRows: this.positiveSetting("maxResultRows") || 5_000,
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
			await (await this.adapter()).health({ timeoutMs: 10_000 });
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

	async listLogs(query: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		const started = Date.now();
		const result = await this.executeNative(await this.adapter(), {
			operation: "list-logs",
			kind: "VictoriaLogsDatasource",
			language: "logsql",
			statement: victoriaLogsSelector(query, this.defaultSelector),
			extension: "io.openplait.victorialogs",
			extensionValue: {
				timeRange: this.range(query),
				limit: query.limit || 500,
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
				latencyMs: result.metadata?.executionTimeMs ?? Date.now() - started,
				freshness: "live",
			},
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
		const result = await this.executeNative(await this.adapter(), {
			operation: "log-series",
			kind: "VictoriaLogsDatasource",
			language: "logsql",
			statement: victoriaLogsSelector(query, this.defaultSelector),
			extension: "io.openplait.victorialogs",
			extensionValue: {
				timeRange: this.range(query),
				step: intervalMsToLabel(computeIntervalMs(query)),
				operation: "hits",
			},
		});
		const rows = openPlaitFramesToRows(result.frames);
		return {
			fields: [
				{ name: "timestamp", type: "time" },
				{ name: "value", type: "number" },
				{ name: "label", type: "string" },
				{ name: "count", type: "number" },
			],
			rows,
			meta: {
				latencyMs: result.metadata?.executionTimeMs ?? Date.now() - started,
				freshness: "live",
			},
		};
	}

	async attributeKeys(signal: Signal, window: QueryTimeRange): Promise<string[]> {
		if (signal !== "logs") return [];
		const clamped = clampTimeRange(window, this.maxQueryRangeMs);
		return (await this.adapter()).fieldNames({
			timeoutMs: 10_000,
			timeRange: {
				from: clamped.start.toISOString(),
				to: clamped.end.toISOString(),
			},
		});
	}

	async distinctValues(key: string, query: OpenLITQuery): Promise<string[]> {
		const range = this.range(query);
		return (await this.adapter()).fieldValues(
			victoriaLogsFieldName(key),
			{ timeoutMs: 10_000, timeRange: range },
			victoriaLogsSelector(query, this.defaultSelector)
		);
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
