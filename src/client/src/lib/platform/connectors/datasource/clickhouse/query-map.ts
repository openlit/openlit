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
import { parseGenerationHealthChips } from "@/lib/platform/generation-health/classify";
import { hasAgentLoopFilter } from "@/lib/platform/agent-loop/classify";

/** Build a `TimeLimit` from an OpenLITQuery time range. */
export function toTimeLimit(query: OpenLITQuery): TimeLimit {
	return {
		// Legacy SQL builders interpolate these values into
		// parseDateTimeBestEffort(). Date#toString includes a parenthesized local
		// timezone name that ClickHouse cannot parse, so preserve ISO explicitly.
		start: query.timeRange.start.toISOString(),
		end: query.timeRange.end.toISOString(),
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
export function toMetricParams(
	query: OpenLITQuery,
	databaseConfigId?: string
): MetricParams {
	const sort = query.sort?.[0];
	const selectedConfig: Record<string, unknown> = {};
	const customFilters: Array<Record<string, unknown>> = [];
	const add = (key: string, value: unknown) => {
		const values = Array.isArray(value) ? value.map(String) : [String(value)];
		selectedConfig[key] = [
			...((selectedConfig[key] as string[] | undefined) || []),
			...values,
		];
	};
	for (const filter of query.filters || []) {
		if (filter.target === "spanName") {
			add(query.signal === "metrics" ? "metricNames" : "spanNames", filter.value);
			continue;
		}
		if (filter.target !== "attribute" || !filter.key) continue;
		if (filter.key === "service.name") {
			add(query.signal === "traces" ? "applicationNames" : "services", filter.value);
			continue;
		}
		if (query.signal === "traces" && filter.key === "gen_ai.request.model") {
			add("models", filter.value);
			continue;
		}
		if (query.signal === "traces" && filter.key === "gen_ai.system") {
			add("providers", filter.value);
			continue;
		}
		if (query.signal === "traces" && filter.key === "gen_ai.operation.name") {
			add("traceTypes", filter.value);
			continue;
		}
		if (query.signal === "traces" && filter.key === "deployment.environment") {
			add("environments", filter.value);
			continue;
		}
		const value = Array.isArray(filter.value) ? filter.value[0] : filter.value;
		customFilters.push({
			attributeType:
				filter.scope === "resource"
					? "ResourceAttributes"
					: query.signal === "logs"
						? "LogAttributes"
						: query.signal === "metrics"
							? "Attributes"
							: "SpanAttributes",
			key: filter.key,
			value: value === undefined ? "" : String(value),
		});
	}
	if (customFilters.length) selectedConfig.customFilters = customFilters;
	if (query.generationHealth?.length) {
		selectedConfig.generationHealth = query.generationHealth;
	}
	if (query.agentLoop) {
		selectedConfig.agentLoop = true;
	}
	return {
		timeLimit: toTimeLimit(query),
		limit: query.limit,
		offset: query.offset,
		statusCode: extractStatusCodes(query),
		databaseConfigId,
		selectedConfig,
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

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values));
}

/**
 * OpenLIT uses `default` as a synthetic stand-in when
 * `deployment.environment` was missing at materialize time. Emitting it as a
 * hard filter empties Tempo/Loki/Prometheus queries (and misses CH rows with
 * an empty attribute). Treat a lone `default` as "no environment filter".
 */
function realEnvironments(cfg: Record<string, unknown>): string[] {
	const environments = stringList(cfg.environments);
	if (environments.length === 1 && environments[0] === "default") {
		return [];
	}
	return environments;
}

function pushEnvironmentFilter(
	filters: NormalizedFilter[],
	cfg: Record<string, unknown>
) {
	const environments = realEnvironments(cfg);
	if (!environments.length) return;
	filters.push({
		target: "attribute",
		scope: "resource",
		key: "deployment.environment",
		op: "in",
		value: environments,
	});
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

	const traceTypes = stringList(cfg.traceTypes);
	if (traceTypes.length) {
		filters.push({
			target: "attribute",
			scope: "span",
			key: "gen_ai.operation.name",
			op: "in",
			value: traceTypes,
		});
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

	pushEnvironmentFilter(filters, cfg);

	const applicationNames = stringList(cfg.applicationNames);
	if (applicationNames.length) {
		filters.push({
			target: "attribute",
			scope: "resource",
			key: "service.name",
			op: "in",
			value: applicationNames,
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

	const maxCost = typeof cfg.maxCost === "number" ? cfg.maxCost : Number(cfg.maxCost);
	if (Number.isFinite(maxCost)) {
		filters.push({
			target: "attribute",
			scope: "span",
			key: "gen_ai.usage.cost",
			op: "lte",
			value: maxCost,
		});
	}

	const customFilters = Array.isArray(cfg.customFilters)
		? (cfg.customFilters as Array<Record<string, unknown>>)
		: [];
	for (const cf of customFilters) {
		const key = typeof cf.key === "string" ? cf.key : "";
		if (!key) continue;
		const attributeType = String(cf.attributeType || cf.type || "");
		if (attributeType === "Field") {
			if (key === "SpanName") {
				filters.push({ target: "spanName", op: "eq", value: String(cf.value ?? "") });
			}
			continue;
		}
		const scope =
			cf.scope === "resource" ||
			attributeType === "ResourceAttributes"
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
 * Build log-signal filters. Prefer agent-scoped `serviceNames` (and
 * `applicationNames`) in addition to the logs UI's `services` key so the
 * agent Monitoring tab stays locked to the selected agent.
 */
function logsFilters(cfg: Record<string, unknown>): NormalizedFilter[] {
	const filters: NormalizedFilter[] = [];

	const services = uniqueStrings([
		...stringList(cfg.serviceNames),
		...stringList(cfg.services),
		...stringList(cfg.applicationNames),
	]);
	if (services.length) {
		filters.push({
			target: "attribute",
			scope: "resource",
			key: "service.name",
			op: "in",
			value: services,
		});
	}

	pushEnvironmentFilter(filters, cfg);

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
 * Build metric-signal filters. Honor agent-scoped `serviceNames` the same way
 * traces do, not only the metrics UI's `services` key.
 */
function metricsFilters(cfg: Record<string, unknown>): NormalizedFilter[] {
	const filters: NormalizedFilter[] = [];

	const metricNames = stringList(cfg.metricNames);
	if (metricNames.length) {
		filters.push({ target: "spanName", op: "in", value: metricNames });
	}

	const services = uniqueStrings([
		...stringList(cfg.serviceNames),
		...stringList(cfg.services),
		...stringList(cfg.applicationNames),
	]);
	if (services.length) {
		filters.push({
			target: "attribute",
			scope: "resource",
			key: "service.name",
			op: "in",
			value: services,
		});
	}

	pushEnvironmentFilter(filters, cfg);

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
	opts: { maxDataPoints?: number; interval?: string; aiSelector?: boolean } = {}
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
		aiSelector: opts.aiSelector ?? signal === "traces",
		interval: opts.interval,
		maxDataPoints: opts.maxDataPoints,
		generationHealth: parseGenerationHealthChips(cfg.generationHealth),
		agentLoop: hasAgentLoopFilter(cfg.agentLoop),
	};
}
