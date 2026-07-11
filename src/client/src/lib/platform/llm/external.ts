/**
 * External-traces path for LLM dashboard widgets.
 * Built-in ClickHouse keeps SQL in sibling modules; this routes through the
 * datasource QueryPlanner (L0/L1/L2) so Tempo/Jaeger/Datadog/etc. all work.
 */

import type { MetricParams } from "@/lib/platform/common";
import { metricParamsToOpenLITQuery } from "@/lib/platform/datasource/clickhouse/query-map";
import {
	intervalFromTimeRange,
	planAndAggregateSpans,
	planAndSpanTimeSeries,
} from "@/lib/platform/datasource/query-planner";
import {
	readLlmRollup,
	readSignalBucketRollup,
} from "@/lib/platform/telemetry/rollups";
import { shouldPreferRollup } from "@/lib/platform/datasource/rollup-policy";
import { getFilterPreviousParams } from "@/helpers/server/platform";
import type { OpenLITQuery } from "@/lib/platform/datasource/types";

async function resolveExternalTraces() {
	const { getTelemetryAdapter, resolveTelemetrySourceDescriptor } =
		await import("@/lib/telemetry-source");
	const descriptor = await resolveTelemetrySourceDescriptor({
		signal: "traces",
	});
	if (descriptor.isBuiltIn || descriptor.type === "clickhouse") {
		return null;
	}
	const adapter = await getTelemetryAdapter({ signal: "traces" });
	return { adapter, descriptor };
}

function asError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export async function externalTotalCost(params: MetricParams) {
	const resolved = await resolveExternalTraces();
	if (!resolved) return null;
	const { adapter, descriptor } = resolved;
	try {
		const agg = async (p: MetricParams) => {
			const frame = await planAndAggregateSpans(
				adapter,
				{
					...metricParamsToOpenLITQuery(p, "traces"),
					aggregations: [
						{ fn: "sum", field: "gen_ai.usage.cost", as: "total_usage_cost" },
					],
				},
				{
					preferRollup: shouldPreferRollup(params),
					readRollup: async (q) => {
						const series = await readSignalBucketRollup(q, {
							sourceId: descriptor.id,
							dbConfigId: descriptor.dbConfigId,
						});
						if (!series) return null;
						const total = (series.rows as Record<string, unknown>[]).reduce(
							(s, r) => s + Number(r.cost ?? 0),
							0
						);
						return {
							fields: [],
							rows: [{ total_usage_cost: total }],
							meta: series.meta,
						};
					},
				}
			);
			return Number(
				(frame.rows[0] as Record<string, unknown> | undefined)
					?.total_usage_cost ?? 0
			);
		};
		const total_usage_cost = await agg(params);
		const previous_total_usage_cost = await agg(getFilterPreviousParams(params));
		return {
			err: null,
			data: [{ total_usage_cost, previous_total_usage_cost }],
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}

export async function externalAverageCost(params: MetricParams) {
	const resolved = await resolveExternalTraces();
	if (!resolved) return null;
	const { adapter } = resolved;
	try {
		const frame = await planAndAggregateSpans(adapter, {
			...metricParamsToOpenLITQuery(params, "traces"),
			aggregations: [
				{ fn: "avg", field: "gen_ai.usage.cost", as: "average_usage_cost" },
			],
		});
		return {
			err: null,
			data: [
				{
					average_usage_cost: Number(
						(frame.rows[0] as Record<string, unknown> | undefined)
							?.average_usage_cost ?? 0
					),
				},
			],
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}

export async function externalCostPerTime(params: MetricParams) {
	const resolved = await resolveExternalTraces();
	if (!resolved) return null;
	const { adapter, descriptor } = resolved;
	try {
		const base = metricParamsToOpenLITQuery(params, "traces");
		const frame = await planAndSpanTimeSeries(
			adapter,
			{
				...base,
				interval: intervalFromTimeRange(
					base.timeRange.start,
					base.timeRange.end
				),
				aggregations: [
					{ fn: "sum", field: "gen_ai.usage.cost", as: "total_cost" },
				],
			},
			{
				preferRollup: shouldPreferRollup(params),
				readRollup: (q) =>
					readSignalBucketRollup(q, {
						sourceId: descriptor.id,
						dbConfigId: descriptor.dbConfigId,
					}),
			}
		);
		return {
			err: null,
			data: (frame.rows as Record<string, unknown>[]).map((row) => ({
				total_cost: Number(row.total_cost ?? row.cost ?? 0),
				request_time: String(row.request_time ?? row.label ?? row.bucket ?? ""),
			})),
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}

export async function externalAverageTokens(
	params: MetricParams & { type?: string }
) {
	const resolved = await resolveExternalTraces();
	if (!resolved) return null;
	const { adapter } = resolved;
	const field =
		params.type === "prompt"
			? "gen_ai.usage.input_tokens"
			: params.type === "completion"
				? "gen_ai.usage.output_tokens"
				: "gen_ai.usage.total_tokens";
	try {
		const frame = await planAndAggregateSpans(adapter, {
			...metricParamsToOpenLITQuery(params, "traces"),
			aggregations: [{ fn: "avg", field, as: "total_tokens" }],
		});
		const total_tokens = Number(
			(frame.rows[0] as Record<string, unknown> | undefined)?.total_tokens ?? 0
		);
		if (params.type === "total") {
			const previous = await planAndAggregateSpans(adapter, {
				...metricParamsToOpenLITQuery(getFilterPreviousParams(params), "traces"),
				aggregations: [{ fn: "avg", field, as: "total_tokens" }],
			});
			return {
				err: null,
				data: [
					{
						total_tokens,
						previous_total_tokens: Number(
							(previous.rows[0] as Record<string, unknown> | undefined)
								?.total_tokens ?? 0
						),
					},
				],
			};
		}
		return { err: null, data: [{ total_tokens }] };
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}

export async function externalTokensPerTime(params: MetricParams) {
	const resolved = await resolveExternalTraces();
	if (!resolved) return null;
	const { adapter, descriptor } = resolved;
	try {
		const base = metricParamsToOpenLITQuery(params, "traces");
		const frame = await planAndSpanTimeSeries(
			adapter,
			{
				...base,
				interval: intervalFromTimeRange(
					base.timeRange.start,
					base.timeRange.end
				),
				aggregations: [
					{ fn: "sum", field: "gen_ai.usage.total_tokens", as: "total_tokens" },
				],
			},
			{
				preferRollup: shouldPreferRollup(params),
				readRollup: (q) =>
					readSignalBucketRollup(q, {
						sourceId: descriptor.id,
						dbConfigId: descriptor.dbConfigId,
					}),
			}
		);
		return {
			err: null,
			data: (frame.rows as Record<string, unknown>[]).map((row) => ({
				total_tokens: Number(row.total_tokens ?? row.tokens ?? 0),
				request_time: String(row.request_time ?? row.label ?? row.bucket ?? ""),
			})),
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}

async function externalGroupBy(
	params: MetricParams,
	field: string,
	dimension: string,
	valueKey: string
) {
	const resolved = await resolveExternalTraces();
	if (!resolved) return null;
	const { adapter, descriptor } = resolved;
	try {
		const query: OpenLITQuery = {
			...metricParamsToOpenLITQuery(params, "traces"),
			groupBy: [field],
			aggregations: [{ fn: "count", as: "count" }],
		};
		const frame = await planAndAggregateSpans(adapter, query, {
			preferRollup: shouldPreferRollup(params),
			readRollup: (q) =>
				readLlmRollup(q, {
					sourceId: descriptor.id,
					dbConfigId: descriptor.dbConfigId,
					dimension,
				}),
		});
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

export async function externalGenerationByCategories(params: MetricParams) {
	return externalGroupBy(
		params,
		"gen_ai.operation.name",
		"category",
		"category"
	);
}

export async function externalGenerationByProvider(params: MetricParams) {
	return externalGroupBy(params, "gen_ai.system", "provider", "provider");
}

export async function externalTopModels(params: MetricParams) {
	return externalGroupBy(params, "gen_ai.request.model", "model", "model");
}

export async function externalCostByApplication(params: MetricParams) {
	const resolved = await resolveExternalTraces();
	if (!resolved) return null;
	const { adapter, descriptor } = resolved;
	try {
		const frame = await planAndAggregateSpans(
			adapter,
			{
				...metricParamsToOpenLITQuery(params, "traces"),
				groupBy: ["service.name"],
				aggregations: [
					{ fn: "sum", field: "gen_ai.usage.cost", as: "total_cost" },
				],
			},
			{
				preferRollup: shouldPreferRollup(params),
				readRollup: (q) =>
					readLlmRollup(q, {
						sourceId: descriptor.id,
						dbConfigId: descriptor.dbConfigId,
						dimension: "service",
					}),
			}
		);
		return {
			err: null,
			data: (frame.rows as Record<string, unknown>[]).map((row) => ({
				application: String(
					row.group_value ?? row.g0 ?? row["service.name"] ?? ""
				),
				total_cost: Number(row.total_cost ?? 0),
			})),
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}

export async function externalCostByEnvironment(params: MetricParams) {
	const resolved = await resolveExternalTraces();
	if (!resolved) return null;
	const { adapter, descriptor } = resolved;
	try {
		const frame = await planAndAggregateSpans(
			adapter,
			{
				...metricParamsToOpenLITQuery(params, "traces"),
				groupBy: ["deployment.environment"],
				aggregations: [
					{ fn: "sum", field: "gen_ai.usage.cost", as: "total_cost" },
				],
			},
			{
				preferRollup: shouldPreferRollup(params),
				readRollup: (q) =>
					readLlmRollup(q, {
						sourceId: descriptor.id,
						dbConfigId: descriptor.dbConfigId,
						dimension: "environment",
					}),
			}
		);
		return {
			err: null,
			data: (frame.rows as Record<string, unknown>[]).map((row) => ({
				environment: String(
					row.group_value ??
						row.g0 ??
						row["deployment.environment"] ??
						""
				),
				cost: Number(row.total_cost ?? 0),
			})),
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}

export async function externalModelsPerTime(params: MetricParams) {
	const resolved = await resolveExternalTraces();
	if (!resolved) return null;
	const { adapter } = resolved;
	try {
		const base = metricParamsToOpenLITQuery(params, "traces");
		const frame = await planAndSpanTimeSeries(adapter, {
			...base,
			interval: intervalFromTimeRange(
				base.timeRange.start,
				base.timeRange.end
			),
			groupBy: ["gen_ai.request.model"],
			aggregations: [{ fn: "count", as: "model_count" }],
		});
		const byTime = new Map<
			string,
			{ models: string[]; model_counts: number[]; total: number }
		>();
		for (const row of frame.rows as Record<string, unknown>[]) {
			const request_time = String(
				row.request_time ?? row.label ?? row.bucket ?? ""
			);
			const model = String(
				row.group_value ?? row.g0 ?? row["gen_ai.request.model"] ?? ""
			);
			const count = Number(row.model_count ?? row.count ?? 0);
			const entry = byTime.get(request_time) || {
				models: [],
				model_counts: [],
				total: 0,
			};
			if (model) {
				entry.models.push(model);
				entry.model_counts.push(count);
			}
			entry.total += count;
			byTime.set(request_time, entry);
		}
		return {
			err: null,
			data: Array.from(byTime.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([request_time, entry]) => ({
					request_time,
					models: entry.models,
					model_counts: entry.model_counts,
					total_model_count: entry.total,
				})),
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}
