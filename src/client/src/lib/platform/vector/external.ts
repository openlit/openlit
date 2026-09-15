/**
 * External-traces path for Vector DB dashboard widgets.
 * Built-in ClickHouse keeps SQL in sibling modules; this routes through the
 * datasource QueryPlanner so Tempo/Jaeger/Datadog/etc. all work.
 */

import type { MetricParams } from "@/lib/platform/common";
import { metricParamsToOpenLITQuery } from "@/lib/platform/connectors/datasource/clickhouse/query-map";
import { planAndAggregateSpans } from "@/lib/platform/connectors/datasource/query-planner";
import type { OpenLITQuery } from "@/lib/platform/connectors/datasource/types";

async function resolveExternalTraces(environment?: string) {
	const { getTelemetryAdapter, resolveTelemetrySourceDescriptor } =
		await import("@/lib/telemetry-source");
	const descriptor = await resolveTelemetrySourceDescriptor({
		signal: "traces",
		environment,
	});
	if (descriptor.isBuiltIn || descriptor.type === "clickhouse") {
		return null;
	}
	const adapter = await getTelemetryAdapter({ signal: "traces", environment });
	return { adapter, descriptor };
}

function asError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function vectordbParams(params: MetricParams): MetricParams {
	return { ...params, operationType: "vectordb" };
}

async function externalGroupBy(
	params: MetricParams,
	field: string,
	valueKey: string
) {
	const resolved = await resolveExternalTraces(params.environment);
	if (!resolved) return null;
	const { adapter } = resolved;
	try {
		const query: OpenLITQuery = {
			...metricParamsToOpenLITQuery(vectordbParams(params), "traces"),
			groupBy: [field],
			aggregations: [{ fn: "count", as: "count" }],
		};
		const frame = await planAndAggregateSpans(adapter, query);
		return {
			err: null,
			data: (frame.rows as Record<string, unknown>[]).map((row) => ({
				[valueKey]: String(row.group_value ?? row.g0 ?? row[field] ?? ""),
				count: Number(row.count ?? 0),
			})),
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}

export async function externalResultGenerationByOperation(params: MetricParams) {
	return externalGroupBy(params, "db.operation", "operation");
}

export async function externalResultGenerationBySystem(params: MetricParams) {
	return externalGroupBy(params, "db.system", "system");
}

export async function externalResultGenerationByEnvironment(params: MetricParams) {
	return externalGroupBy(params, "deployment.environment", "environment");
}

export async function externalResultGenerationByApplication(params: MetricParams) {
	return externalGroupBy(params, "service.name", "applicationName");
}
