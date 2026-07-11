/**
 * Map between the vendor-agnostic `OpenLITQuery` and the existing ClickHouse
 * `MetricParams` shape used by Telemetry UI filters / query builders.
 */

import type { MetricParams, TimeLimit } from "@/lib/platform/common";
import type {
	NormalizedFilter,
	OpenLITQuery,
	QuerySort,
	Signal,
} from "../types";

/** Build a `TimeLimit` from an OpenLITQuery time range. */
export function toTimeLimit(query: OpenLITQuery): TimeLimit {
	return {
		start: query.timeRange.start,
		end: query.timeRange.end,
		type: "CUSTOM",
	};
}

/**
 * Extract a status-code filter (if present) into the `statusCode` array the
 * builders understand.
 */
function extractStatusCodes(query: OpenLITQuery): string[] | undefined {
	const codes = (query.filters || [])
		.filter((f) => f.target === "status")
		.flatMap((f) => (Array.isArray(f.value) ? f.value : [f.value]))
		.filter((v): v is string => typeof v === "string");
	return codes.length ? codes : undefined;
}

/** Build a `MetricParams` from an OpenLITQuery. */
export function toMetricParams(query: OpenLITQuery): MetricParams {
	const sort = query.sort?.[0];
	return {
		timeLimit: toTimeLimit(query),
		limit: query.limit,
		offset: query.offset,
		statusCode: extractStatusCodes(query),
		sorting: sort
			? { type: sort.field, direction: sort.direction }
			: undefined,
	} as MetricParams;
}

function asDate(value: Date | string | undefined, fallback: Date): Date {
	if (value instanceof Date) return value;
	if (typeof value === "string" && value) {
		const d = new Date(value);
		if (!Number.isNaN(d.getTime())) return d;
	}
	return fallback;
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((v) => String(v)).filter((v) => v.length > 0);
}

type CustomFilterOp = "eq" | "neq" | "contains" | "in";

function normalizeCustomFilterOp(cf: Record<string, unknown>): CustomFilterOp {
	const opRaw = String(cf.operator || cf.op || "eq");
	if (opRaw === "neq" || opRaw === "!=") return "neq";
	if (opRaw === "contains") return "contains";
	if (opRaw === "in") return "in";
	return "eq";
}

function customFilterValue(value: unknown): string | string[] | undefined {
	if (Array.isArray(value)) return value.map(String);
	return value !== undefined ? String(value) : undefined;
}

/** Build the trace-signal filters (models/providers/spanNames/services/custom). */
function tracesFilters(cfg: Record<string, unknown>): NormalizedFilter[] {
	const filters: NormalizedFilter[] = [];

	const models = stringList(cfg.models);
	if (models.length) {
		filters.push({
			target: "attribute",
			scope: "span",
			key: "gen_ai.request.model",
			op: "in",
			value: models,
		});
	}

	const providers = stringList(cfg.providers);
	if (providers.length) {
		// Primary GenAI provider attr; adapters that only support equality may
		// degrade. Multi-namespace OR (db.system / coding_agent.client) stays
		// ClickHouse-native for now.
		filters.push({
			target: "attribute",
			scope: "span",
			key: "gen_ai.system",
			op: "in",
			value: providers,
		});
	}

	const spanNames = stringList(cfg.spanNames);
	if (spanNames.length) {
		filters.push({ target: "spanName", op: "in", value: spanNames });
	}

	const serviceNames = stringList(cfg.serviceNames);
	if (serviceNames.length) {
		filters.push({
			target: "attribute",
			scope: "resource",
			key: "service.name",
			op: "in",
			value: serviceNames,
		});
	}

	const environments = stringList(cfg.environments);
	if (environments.length) {
		filters.push({
			target: "attribute",
			scope: "resource",
			key: "deployment.environment",
			op: "in",
			value: environments,
		});
	}

	const versionFilter = cfg.versionFilter as
		| { versionHash?: string; firstSeen?: string; lastSeen?: string }
		| undefined;
	if (versionFilter?.versionHash) {
		filters.push({
			target: "attribute",
			key: "openlit.agent.version_hash",
			op: "eq",
			value: String(versionFilter.versionHash),
		});
	}

	const customFilters = Array.isArray(cfg.customFilters)
		? (cfg.customFilters as Array<Record<string, unknown>>)
		: [];
	for (const cf of customFilters) {
		const key = typeof cf.key === "string" ? cf.key : "";
		if (!key) continue;
		const scope =
			cf.scope === "resource" || cf.type === "ResourceAttributes"
				? "resource"
				: "span";
		filters.push({
			target: "attribute",
			scope,
			key,
			op: normalizeCustomFilterOp(cf),
			value: customFilterValue(cf.value),
		});
	}

	return filters;
}

/**
 * Build log-signal filters. `services` maps to the resource service name;
 * `severities` is best-effort (adapters map to their level label). Custom
 * filters carry their attribute scope (log / resource). Correlation-only
 * fields (traceIds/spanIds) stay ClickHouse-native and are omitted here.
 */
function logsFilters(cfg: Record<string, unknown>): NormalizedFilter[] {
	const filters: NormalizedFilter[] = [];

	const services = stringList(cfg.services);
	if (services.length) {
		filters.push({
			target: "attribute",
			scope: "resource",
			key: "service.name",
			op: "in",
			value: services,
		});
	}

	const severities = stringList(cfg.severities);
	if (severities.length) {
		filters.push({
			target: "attribute",
			scope: "log",
			key: "severity",
			op: "in",
			value: severities,
		});
	}

	const customFilters = Array.isArray(cfg.customFilters)
		? (cfg.customFilters as Array<Record<string, unknown>>)
		: [];
	for (const cf of customFilters) {
		const key = typeof cf.key === "string" ? cf.key : "";
		if (!key) continue;
		const attrType = String(cf.attributeType || cf.type || "");
		const scope =
			attrType === "ResourceAttributes" || cf.scope === "resource"
				? "resource"
				: "log";
		filters.push({
			target: "attribute",
			scope,
			key,
			op: normalizeCustomFilterOp(cf),
			value: customFilterValue(cf.value),
		});
	}

	return filters;
}

/**
 * Build metric-signal filters. `metricNames` maps to the `spanName` target
 * (which the metrics signal interprets as the metric name). `services` maps to
 * the resource service name; custom filters carry their attribute scope.
 * `metricTypes` (the ClickHouse table split) is not portable and is omitted.
 */
function metricsFilters(cfg: Record<string, unknown>): NormalizedFilter[] {
	const filters: NormalizedFilter[] = [];

	const metricNames = stringList(cfg.metricNames);
	if (metricNames.length) {
		filters.push({ target: "spanName", op: "in", value: metricNames });
	}

	const services = stringList(cfg.services);
	if (services.length) {
		filters.push({
			target: "attribute",
			scope: "resource",
			key: "service.name",
			op: "in",
			value: services,
		});
	}

	const customFilters = Array.isArray(cfg.customFilters)
		? (cfg.customFilters as Array<Record<string, unknown>>)
		: [];
	for (const cf of customFilters) {
		const key = typeof cf.key === "string" ? cf.key : "";
		if (!key) continue;
		const attrType = String(cf.attributeType || cf.type || "");
		const scope =
			attrType === "ResourceAttributes" || cf.scope === "resource"
				? "resource"
				: "metric";
		filters.push({
			target: "attribute",
			scope,
			key,
			op: normalizeCustomFilterOp(cf),
			value: customFilterValue(cf.value),
		});
	}

	return filters;
}

/**
 * Map Telemetry UI `MetricParams` onto an `OpenLITQuery` for external adapters.
 * Covers time range, pagination, sort, status, and the signal-specific
 * `selectedConfig` filters. Filters a vendor cannot express are best-effort —
 * adapters push what they can and may return a broader set. `aiSelector` is
 * pushed for traces (the AI intelligence surface); logs/metrics are returned
 * as-is so the observability pages match their ClickHouse behavior.
 */
export function metricParamsToOpenLITQuery(
	params: MetricParams,
	signal: Signal = "traces",
	opts: { maxDataPoints?: number; interval?: string } = {}
): OpenLITQuery {
	const now = new Date();
	const start = asDate(
		params.timeLimit?.start as Date | string,
		new Date(now.getTime() - 60 * 60 * 1000)
	);
	const end = asDate(params.timeLimit?.end as Date | string, now);
	const cfg = (params.selectedConfig || {}) as Record<string, unknown>;
	const filters: NormalizedFilter[] = [];

	if (signal === "traces" && params.statusCode?.length) {
		filters.push({ target: "status", op: "in", value: params.statusCode });
	}

	// Mirror ClickHouse `operationType` (llm vs vectordb) onto gen_ai.operation.name.
	if (signal === "traces" && params.operationType === "vectordb") {
		filters.push({
			target: "attribute",
			scope: "span",
			key: "gen_ai.operation.name",
			op: "eq",
			value: "vectordb",
		});
	} else if (signal === "traces" && params.operationType === "llm") {
		filters.push({
			target: "attribute",
			scope: "span",
			key: "gen_ai.operation.name",
			op: "neq",
			value: "vectordb",
		});
	}

	if (signal === "traces") filters.push(...tracesFilters(cfg));
	else if (signal === "logs") filters.push(...logsFilters(cfg));
	else if (signal === "metrics") filters.push(...metricsFilters(cfg));

	let sort: QuerySort[] | undefined;
	if (params.sorting?.type) {
		sort = [
			{
				field: String(params.sorting.type),
				direction: params.sorting.direction === "asc" ? "asc" : "desc",
			},
		];
	}

	return {
		signal,
		timeRange: { start, end },
		filters: filters.length ? filters : undefined,
		sort,
		limit: params.limit,
		offset: params.offset,
		aiSelector: signal === "traces",
		interval: opts.interval,
		maxDataPoints: opts.maxDataPoints,
	};
}
