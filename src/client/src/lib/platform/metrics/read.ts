/**
 * Metrics read facade — the choke point for the Metrics observability page.
 *
 * Every source resolves through the shared signal facade. Point-level results
 * are folded into the grouped list rows the existing page renders.
 */

import type { MetricParams } from "@/lib/platform/common";
import { getSummaryBucket } from "@/lib/platform/observability";
import { metricParamsToOpenLITQuery } from "@/lib/platform/connectors/datasource/clickhouse/query-map";
import { denormalizeMetricPointsToListRows } from "@/lib/platform/connectors/datasource/clickhouse/normalize";
import {
	facadeErrorMessage,
	resolveSignalReadContext,
} from "@/lib/platform/connectors/datasource/facade";
import type { NormalizedMetricPoint } from "@/lib/platform/connectors/datasource/types";

/** List grouped metric series (same shape as `getMetrics`). */
export async function listMetricRecords(params: MetricParams) {
	const { adapter } = await resolveSignalReadContext("metrics", params);

	try {
		const query = metricParamsToOpenLITQuery(params, "metrics");
		const frame = await adapter.listMetricSeries(query);
		const records = denormalizeMetricPointsToListRows(
			frame.rows as NormalizedMetricPoint[]
		);
		const limit = params.limit || 25;
		const offset = params.offset || 0;
		return {
			err: null,
			records: records.slice(offset, offset + limit),
			total: Number(frame.meta?.rowsScanned) || records.length,
		};
	} catch (err) {
		return { err: facadeErrorMessage(err) };
	}
}

/** Filter-bar config (services / metricNames / metricTypes). */
export async function getMetricsFilterConfig(params: MetricParams) {
	const { adapter } = await resolveSignalReadContext("metrics", params);

	const emptyRow = {
		services: [] as string[],
		metricNames: [] as string[],
		metricTypes: [] as string[],
		totalRows: 0,
	};
	try {
		const query = metricParamsToOpenLITQuery(params, "metrics");
		const metricNames = await adapter
			.metricNames(query.timeRange)
			.catch(() => [] as string[]);
		let services: string[] = [];
		if (adapter.capabilities().distinctValues) {
			services = await adapter
				.distinctValues("service.name", query)
				.catch(() => [] as string[]);
			// Prometheus self-scrapes often only expose `job` until apps set
			// service_name; fall back so the Services filter is not empty.
			if (!services.length) {
				services = await adapter
					.distinctValues("job", query)
					.catch(() => [] as string[]);
			}
		}
		return {
			err: null,
			data: [
				{
					...emptyRow,
					services: Array.from(new Set(services.map(String).filter(Boolean))).sort(
						(a, b) => a.localeCompare(b)
					),
					metricNames: Array.from(
						new Set(metricNames.map(String).filter(Boolean))
					).sort((a, b) => a.localeCompare(b)),
				},
			],
		};
	} catch (err) {
		return { err: facadeErrorMessage(err), data: [emptyRow] };
	}
}

/** Attribute-key discovery for the custom-filter builder. */
export async function getMetricAttributeKeysRecord(params: MetricParams) {
	const { adapter } = await resolveSignalReadContext("metrics", params);

	const empty = {
		err: null,
		spanAttributeKeys: [] as string[],
		resourceAttributeKeys: [] as string[],
		metricAttributeKeys: [] as string[],
		scopeAttributeKeys: [] as string[],
	};
	try {
		const query = metricParamsToOpenLITQuery(params, "metrics");
		const keys = await adapter.attributeKeys("metrics", query.timeRange);
		// Prometheus labels are shared across metric/resource scopes in the UI
		// filter builder; expose them under both buckets so either dropdown works.
		return {
			...empty,
			metricAttributeKeys: keys,
			resourceAttributeKeys: keys,
		};
	} catch {
		return empty;
	}
}

/** Metric detail (time series + latest raw points). */
export async function getMetricDetailRecord(
	metricName: string,
	metricType?: string,
	serviceName?: string,
	params?: MetricParams
) {
	const { adapter } = await resolveSignalReadContext("metrics", params);

	try {
		const base = metricParamsToOpenLITQuery(
			params || { timeLimit: {} as MetricParams["timeLimit"] },
			"metrics"
		);
		const query = {
			...base,
			filters: [
				...(base.filters || []),
				{ target: "spanName" as const, op: "in" as const, value: [metricName] },
			],
		};
		const frame = await adapter.metricTimeSeries(query);
		const points = frame.rows as NormalizedMetricPoint[];
		const series = points
			.map((p) => ({ request_time: p.timestamp, value: p.value }))
			.sort((a, b) => a.request_time.localeCompare(b.request_time));
		const rawPoints = points.map((p) => ({
			MetricName: p.metricName,
			metric_type: metricType || "gauge",
			metric_value: p.value,
			metric_sample_count: 1,
			TimeUnix: p.timestamp,
			MetricUnit: p.unit || "",
			MetricDescription: p.description || "",
			ServiceName: p.serviceName || "",
			Attributes: p.attributes || {},
			ResourceAttributes: p.resourceAttributes || {},
		}));
		return { err: null, series, points: rawPoints };
	} catch (err) {
		return { err: facadeErrorMessage(err), series: [], points: [] };
	}
}

/** Metrics summary bar-chart series (same shape as `getSignalSummary(_, "metrics")`). */
export async function getMetricsSummary(params: MetricParams) {
	const { adapter } = await resolveSignalReadContext("metrics", params);

	const bucket = getSummaryBucket(params);
	const empty = { err: null, bucket, buckets: [], total: 0, peak: 0 };
	try {
		const base = metricParamsToOpenLITQuery(params, "metrics");
		// Prefer a server-side count aggregation so Prometheus/Loki-style sources
		// return one series instead of every raw sample (which blows up the chart).
		const query = {
			...base,
			aggregations: base.aggregations?.length
				? base.aggregations
				: [{ fn: "count" as const, field: "value" }],
		};
		const frame = await adapter.metricTimeSeries(query);
		const merged = new Map<
			string,
			{ count: number; metrics: number; services: number }
		>();
		for (const row of frame.rows as unknown as Record<string, unknown>[]) {
			const label = String(row.label ?? row.timestamp ?? row.request_time ?? "");
			if (!label) continue;
			const count = Number(row.count ?? row.value ?? 0);
			if (!Number.isFinite(count)) continue;
			const prev = merged.get(label) || { count: 0, metrics: 0, services: 0 };
			merged.set(label, {
				count: prev.count + count,
				metrics: prev.metrics + (Number(row.metrics) || 0),
				services: prev.services + (Number(row.services) || 0),
			});
		}
		const buckets = Array.from(merged.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([label, stats]) => ({
				label,
				count: stats.count,
				metrics: stats.metrics,
				services: stats.services,
			}));
		const total = buckets.reduce((sum, b) => sum + b.count, 0);
		const peak = buckets.reduce((max, b) => Math.max(max, b.count), 0);
		return { err: null, bucket, buckets, total, peak };
	} catch (err) {
		return { ...empty, err: facadeErrorMessage(err) };
	}
}
