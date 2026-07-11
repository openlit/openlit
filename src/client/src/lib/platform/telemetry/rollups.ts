/**
 * L2 telemetry rollups — OpenLIT-owned derived tables for dashboard KPIs.
 *
 * Background materialization pulls bounded samples via any DataSourceAdapter
 * and writes constant-latency aggregates. QueryPlanner prefers these when
 * fresh; detail/list still hit the live vendor (or the recent-span hot cache).
 *
 * Retention: rollups TTL 90d; hot cache TTL 2h + row cap. Never a full mirror
 * of vendor o11y data.
 */

import type {
	DataFrame,
	DataSourceAdapter,
	NormalizedFilter,
	NormalizedSpan,
	OpenLITQuery,
} from "@/lib/platform/datasource/types";
import {
	computeAggregateSpansL1,
	computeSpanTimeSeriesL1,
} from "@/lib/platform/datasource/l1-compute";
import { fetchSpansForList } from "@/lib/platform/datasource/graph/sample-fetch";

export const SIGNAL_BUCKETS_TABLE = "openlit_signal_buckets";
export const LLM_ROLLUPS_TABLE = "openlit_llm_rollups";
export const SPAN_HOT_CACHE_TABLE = "openlit_external_span_cache";

/** Max age for a rollup row to be considered fresh enough for L2 reads. */
export const ROLLUP_FRESHNESS_MS = 5 * 60 * 1000;
/** Soft row cap for the recent-span hot cache per source. */
export const SPAN_HOT_CACHE_MAX_ROWS = 2_000;

function escape(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeJson(value: unknown): string {
	return escape(JSON.stringify(value ?? {}));
}

async function collector(
	query: { query: string },
	type: "query" | "exec",
	dbConfigId?: string
) {
	const { dataCollector } = await import("@/lib/platform/common");
	return dataCollector(query, type, dbConfigId);
}

async function logError(event: string, meta: Record<string, unknown>) {
	try {
		const { agentsLogger } = await import("@/lib/platform/agents/logger");
		agentsLogger.error(event, meta);
	} catch {
		// ignore
	}
}

function filterValues(
	filters: NormalizedFilter[] | undefined,
	key: string
): string[] {
	const out: string[] = [];
	for (const f of filters || []) {
		if (f.target !== "attribute" || f.key !== key) continue;
		if (Array.isArray(f.value)) {
			out.push(...f.value.map(String).filter(Boolean));
		} else if (f.value !== undefined && f.value !== "") {
			out.push(String(f.value));
		}
	}
	return Array.from(new Set(out));
}

function inListSql(column: string, values: string[]): string {
	if (!values.length) return "";
	return `AND ${column} IN (${values.map((v) => `'${escape(v)}'`).join(", ")})`;
}

function isFresh(updatedAt: unknown): boolean {
	const t = new Date(String(updatedAt || 0)).getTime();
	return Number.isFinite(t) && Date.now() - t <= ROLLUP_FRESHNESS_MS;
}

/**
 * Read time-bucket rollups for spanTimeSeries-shaped queries.
 * Returns null when no fresh rows cover the window.
 */
export async function readSignalBucketRollup(
	query: OpenLITQuery,
	opts?: { sourceId?: string; dbConfigId?: string }
): Promise<DataFrame | null> {
	const sourceId = opts?.sourceId || "";
	const start = query.timeRange.start.toISOString();
	const end = query.timeRange.end.toISOString();
	const as = query.aggregations?.[0]?.as || "count";
	const services = filterValues(query.filters, "service.name");
	const environments = filterValues(query.filters, "deployment.environment");
	const sql = `
		SELECT
			bucket_start AS bucket,
			bucket_start AS label,
			bucket_start AS request_time,
			sum(request_count) AS ${as},
			sum(request_count) AS count,
			sum(request_count) AS total,
			avg(avg_duration_seconds) AS avgDuration,
			sum(total_cost) AS cost,
			sum(total_tokens) AS tokens,
			max(updated_at) AS updated_at
		FROM ${SIGNAL_BUCKETS_TABLE}
		WHERE source_id = '${escape(sourceId)}'
			AND bucket_start >= parseDateTimeBestEffort('${escape(start)}')
			AND bucket_start <= parseDateTimeBestEffort('${escape(end)}')
			${inListSql("service", services)}
			${inListSql("environment", environments)}
		GROUP BY bucket_start
		ORDER BY bucket_start ASC
	`;
	try {
		const { data, err } = await collector(
			{ query: sql },
			"query",
			opts?.dbConfigId
		);
		if (err || !Array.isArray(data) || data.length === 0) return null;
		const rows = data as Record<string, unknown>[];
		const newest = rows.reduce((max, r) => {
			const t = new Date(String(r.updated_at || 0)).getTime();
			return Number.isFinite(t) ? Math.max(max, t) : max;
		}, 0);
		if (!newest || !isFresh(newest)) return null;
		return {
			fields: [],
			rows: rows.map(({ updated_at: _u, ...rest }) => rest),
			meta: { degraded: ["rollup"], freshness: "accelerated" },
		};
	} catch {
		return null;
	}
}

/**
 * Read LLM groupBy rollups (model/provider/category/service/environment).
 * Scoped service/env filters are applied against multi-dimensional columns.
 */
export async function readLlmRollup(
	query: OpenLITQuery,
	opts?: { sourceId?: string; dbConfigId?: string; dimension?: string }
): Promise<DataFrame | null> {
	const sourceId = opts?.sourceId || "";
	const dimension = opts?.dimension || query.groupBy?.[0] || "model";
	const start = query.timeRange.start.toISOString();
	const end = query.timeRange.end.toISOString();
	const services = filterValues(query.filters, "service.name");
	const environments = filterValues(query.filters, "deployment.environment");
	const sql = `
		SELECT
			group_value AS g0,
			group_value AS group_value,
			sum(request_count) AS count,
			sum(total_cost) AS total_cost,
			sum(total_tokens) AS total_tokens,
			avg(avg_duration_seconds) AS avg_duration_seconds,
			max(updated_at) AS updated_at
		FROM ${LLM_ROLLUPS_TABLE}
		WHERE source_id = '${escape(sourceId)}'
			AND dimension = '${escape(dimension)}'
			AND window_start >= parseDateTimeBestEffort('${escape(start)}')
			AND window_end <= parseDateTimeBestEffort('${escape(end)}')
			${inListSql("service", services)}
			${inListSql("environment", environments)}
		GROUP BY group_value
		ORDER BY count DESC
		LIMIT ${Number(query.limit || 100)}
	`;
	try {
		const { data, err } = await collector(
			{ query: sql },
			"query",
			opts?.dbConfigId
		);
		if (err || !Array.isArray(data) || data.length === 0) return null;
		const rows = data as Record<string, unknown>[];
		const newest = rows.reduce((max, r) => {
			const t = new Date(String(r.updated_at || 0)).getTime();
			return Number.isFinite(t) ? Math.max(max, t) : max;
		}, 0);
		if (!newest || !isFresh(newest)) return null;
		return {
			fields: [],
			rows: rows.map(({ updated_at: _u, ...rest }) => rest),
			meta: { degraded: ["rollup"], freshness: "accelerated" },
		};
	} catch {
		return null;
	}
}

function parseAttrs(raw: unknown): Record<string, string> {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		return Object.fromEntries(
			Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
				k,
				String(v ?? ""),
			])
		);
	}
	if (typeof raw !== "string" || !raw) return {};
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return Object.fromEntries(
			Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")])
		);
	} catch {
		return {};
	}
}

function rowToSpan(row: Record<string, unknown>): NormalizedSpan {
	return {
		traceId: String(row.trace_id || ""),
		spanId: String(row.span_id || ""),
		parentSpanId: String(row.parent_span_id || ""),
		name: String(row.name || ""),
		serviceName: String(row.service_name || ""),
		timestamp: String(row.timestamp || ""),
		durationNs: Number(row.duration_ns || 0),
		statusCode: String(row.status_code || ""),
		statusMessage: String(row.status_message || "") || undefined,
		spanKind: String(row.span_kind || "") || undefined,
		spanAttributes: parseAttrs(row.span_attributes),
		resourceAttributes: parseAttrs(row.resource_attributes),
		cost: Number(row.cost || 0) || undefined,
	};
}

/**
 * Read bounded recent root spans from the hot cache (L2 list path).
 */
export async function readSpanHotCache(
	query: OpenLITQuery,
	opts: { sourceId: string; dbConfigId?: string; maxRows?: number }
): Promise<{ spans: NormalizedSpan[]; truncated: boolean } | null> {
	const start = query.timeRange.start.toISOString();
	const end = query.timeRange.end.toISOString();
	const services = filterValues(query.filters, "service.name");
	const environments = filterValues(query.filters, "deployment.environment");
	const limit = Math.min(
		opts.maxRows ?? query.limit ?? 100,
		SPAN_HOT_CACHE_MAX_ROWS
	);
	const sql = `
		SELECT
			trace_id, span_id, parent_span_id, name, service_name, environment,
			timestamp, duration_ns, status_code, status_message, span_kind,
			span_attributes, resource_attributes, cost, updated_at
		FROM ${SPAN_HOT_CACHE_TABLE}
		WHERE source_id = '${escape(opts.sourceId)}'
			AND timestamp >= parseDateTimeBestEffort('${escape(start)}')
			AND timestamp <= parseDateTimeBestEffort('${escape(end)}')
			${inListSql("service_name", services)}
			${inListSql("environment", environments)}
		ORDER BY timestamp DESC
		LIMIT ${limit + 1}
	`;
	try {
		const { data, err } = await collector(
			{ query: sql },
			"query",
			opts.dbConfigId
		);
		if (err || !Array.isArray(data) || data.length === 0) return null;
		const rows = data as Record<string, unknown>[];
		const newest = rows.reduce((max, r) => {
			const t = new Date(String(r.updated_at || 0)).getTime();
			return Number.isFinite(t) ? Math.max(max, t) : max;
		}, 0);
		if (!newest || !isFresh(newest)) return null;
		const truncated = rows.length > limit;
		return {
			spans: rows.slice(0, limit).map(rowToSpan),
			truncated,
		};
	} catch {
		return null;
	}
}

/**
 * Upsert stratified list roots into the hot cache (called from background sync).
 */
export async function writeSpanHotCache(opts: {
	sourceId: string;
	dbConfigId?: string;
	spans: NormalizedSpan[];
}): Promise<number> {
	const spans = opts.spans.slice(0, SPAN_HOT_CACHE_MAX_ROWS);
	if (!spans.length) return 0;
	const values = spans.map((span) => {
		const env =
			span.resourceAttributes?.["deployment.environment"] ||
			span.spanAttributes?.["deployment.environment"] ||
			"";
		const ts = span.timestamp
			? new Date(span.timestamp).toISOString()
			: new Date().toISOString();
		return `(
			'${escape(opts.sourceId)}',
			'${escape(span.traceId)}',
			'${escape(span.spanId)}',
			'${escape(span.parentSpanId || "")}',
			'${escape(span.name || "")}',
			'${escape(span.serviceName || "")}',
			'${escape(env)}',
			parseDateTimeBestEffort('${escape(ts)}'),
			${Number(span.durationNs || 0)},
			'${escape(span.statusCode || "")}',
			'${escape(span.statusMessage || "")}',
			'${escape(span.spanKind || "")}',
			'${escapeJson(span.spanAttributes)}',
			'${escapeJson(span.resourceAttributes)}',
			${Number(span.cost || 0)},
			now()
		)`;
	});
	await collector(
		{
			query: `
				INSERT INTO ${SPAN_HOT_CACHE_TABLE}
				(source_id, trace_id, span_id, parent_span_id, name, service_name,
				 environment, timestamp, duration_ns, status_code, status_message,
				 span_kind, span_attributes, resource_attributes, cost, updated_at)
				VALUES ${values.join(",")}
			`,
		},
		"exec",
		opts.dbConfigId
	);
	return values.length;
}

/**
 * Materialize rollups + hot cache for one traces adapter into the app store.
 * Safe to call from cron; uses L1 sample compute under the hood.
 */
export async function materializeTelemetryRollups(opts: {
	adapter: DataSourceAdapter;
	sourceId: string;
	dbConfigId?: string;
	windowHours?: number;
}): Promise<{ buckets: number; llmRows: number; hotCacheRows: number }> {
	const end = new Date();
	const hours = opts.windowHours ?? 24;
	const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
	const baseQuery: OpenLITQuery = {
		signal: "traces",
		timeRange: { start, end },
		aiSelector: true,
		interval: "1h",
		limit: 100,
	};

	let buckets = 0;
	let llmRows = 0;
	let hotCacheRows = 0;

	const services =
		typeof opts.adapter.discoverServices === "function"
			? (
					await opts.adapter.discoverServices({ start, end }).catch(() => [])
				)
					.map((s) => s.serviceName)
					.filter(Boolean)
					.slice(0, 24)
			: [];
	const serviceScopes = services.length ? services : [""];

	try {
		for (const service of serviceScopes) {
			const scoped: OpenLITQuery = service
				? {
						...baseQuery,
						filters: [
							{
								target: "attribute",
								scope: "resource",
								key: "service.name",
								op: "eq",
								value: service,
							},
						],
					}
				: baseQuery;
			const series = await computeSpanTimeSeriesL1(opts.adapter, {
				...scoped,
				aggregations: [
					{ fn: "count", as: "count" },
					{ fn: "avg", field: "duration", as: "avgDuration" },
					{ fn: "sum", field: "gen_ai.usage.cost", as: "cost" },
					{ fn: "sum", field: "gen_ai.usage.total_tokens", as: "tokens" },
				],
			});
			const values = (series.rows as Record<string, unknown>[])
				.map((row) => {
					const bucket = String(
						row.bucket || row.label || row.request_time || ""
					);
					if (!bucket) return null;
					return `(
						'${escape(opts.sourceId)}',
						'${escape(service)}',
						'',
						parseDateTimeBestEffort('${escape(bucket)}'),
						${Number(row.count || 0)},
						${Number(row.avgDuration || 0)},
						${Number(row.cost || 0)},
						${Number(row.tokens || 0)},
						now()
					)`;
				})
				.filter(Boolean);
			if (values.length) {
				await collector(
					{
						query: `
						INSERT INTO ${SIGNAL_BUCKETS_TABLE}
						(source_id, service, environment, bucket_start, request_count,
						 avg_duration_seconds, total_cost, total_tokens, updated_at)
						VALUES ${values.join(",")}
					`,
					},
					"exec",
					opts.dbConfigId
				);
				buckets += values.length;
			}
		}
	} catch (err) {
		await logError("telemetry_rollup_buckets_failed", { err });
	}

	const dimensions: { dimension: string; field: string }[] = [
		{ dimension: "model", field: "gen_ai.request.model" },
		{ dimension: "provider", field: "gen_ai.system" },
		{ dimension: "category", field: "gen_ai.operation.name" },
		{ dimension: "service", field: "service.name" },
		{ dimension: "environment", field: "deployment.environment" },
	];

	for (const service of serviceScopes) {
		const scopedFilters: NormalizedFilter[] = service
			? [
					{
						target: "attribute",
						scope: "resource",
						key: "service.name",
						op: "eq",
						value: service,
					},
				]
			: [];
		for (const { dimension, field } of dimensions) {
			try {
				const frame = await computeAggregateSpansL1(opts.adapter, {
					...baseQuery,
					filters: scopedFilters,
					groupBy: [field],
					aggregations: [
						{ fn: "count", as: "count" },
						{ fn: "sum", field: "gen_ai.usage.cost", as: "total_cost" },
						{
							fn: "sum",
							field: "gen_ai.usage.total_tokens",
							as: "total_tokens",
						},
						{ fn: "avg", field: "duration", as: "avg_duration_seconds" },
					],
				});
				const values = (frame.rows as Record<string, unknown>[])
					.map((row) => {
						const groupValue = String(
							row.group_value ?? row.g0 ?? row[field] ?? ""
						);
						if (!groupValue) return null;
						const model =
							dimension === "model"
								? groupValue
								: String(row.model || row["gen_ai.request.model"] || "");
						const provider =
							dimension === "provider"
								? groupValue
								: String(row.provider || row["gen_ai.system"] || "");
						return `(
							'${escape(opts.sourceId)}',
							'${escape(dimension)}',
							'${escape(groupValue)}',
							'${escape(service)}',
							'',
							'${escape(model)}',
							'${escape(provider)}',
							parseDateTimeBestEffort('${escape(start.toISOString())}'),
							parseDateTimeBestEffort('${escape(end.toISOString())}'),
							${Number(row.count || 0)},
							${Number(row.total_cost || 0)},
							${Number(row.total_tokens || 0)},
							${Number(row.avg_duration_seconds || 0)},
							now()
						)`;
					})
					.filter(Boolean);
				if (values.length) {
					await collector(
						{
							query: `
								INSERT INTO ${LLM_ROLLUPS_TABLE}
								(source_id, dimension, group_value, service, environment, model, provider,
								 window_start, window_end, request_count, total_cost, total_tokens,
								 avg_duration_seconds, updated_at)
								VALUES ${values.join(",")}
							`,
						},
						"exec",
						opts.dbConfigId
					);
					llmRows += values.length;
				}
			} catch (err) {
				await logError("telemetry_rollup_llm_failed", { err, dimension, service });
			}
		}
	}

	try {
		const list = await fetchSpansForList(opts.adapter, baseQuery, {
			maxRows: Math.min(200, SPAN_HOT_CACHE_MAX_ROWS),
			skipCache: true,
		});
		hotCacheRows = await writeSpanHotCache({
			sourceId: opts.sourceId,
			dbConfigId: opts.dbConfigId,
			spans: list.spans,
		});
	} catch (err) {
		await logError("telemetry_hot_cache_failed", { err });
	}

	return { buckets, llmRows, hotCacheRows };
}
