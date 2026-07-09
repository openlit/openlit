/**
 * Metrics read facade — the choke point for the Metrics observability page.
 *
 * Built-in ClickHouse keeps the existing `lib/platform/observability` SQL path
 * (UNION over the five OTel metric tables). External sources resolve via
 * `getTelemetryAdapter({ signal: "metrics" })`: point-level results are folded
 * into the same grouped list rows the ClickHouse page renders.
 */

import type { MetricParams } from "@/lib/platform/common";
import {
	getMetricAttributeKeys,
	getMetricDetail,
	getMetrics,
	getMetricsConfig,
	getSignalSummary,
	getSummaryBucket,
} from "@/lib/platform/observability";
import { metricParamsToOpenLITQuery } from "@/lib/platform/datasource/clickhouse/query-map";
import { denormalizeMetricPointsToListRows } from "@/lib/platform/datasource/clickhouse/normalize";
import {
	facadeErrorMessage,
	resolveSignalReadContext,
} from "@/lib/platform/datasource/facade";
import type { NormalizedMetricPoint } from "@/lib/platform/datasource/types";

/** List grouped metric series (same shape as `getMetrics`). */
export async function listMetricRecords(params: MetricParams) {
	const { adapter, isBuiltIn } = await resolveSignalReadContext("metrics");
	if (isBuiltIn) return getMetrics(params);

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
			total: records.length,
		};
	} catch (err) {
		return { err: facadeErrorMessage(err) };
	}
}

/** Filter-bar config (services / metricNames / metricTypes). */
export async function getMetricsFilterConfig(params: MetricParams) {
	const { adapter, isBuiltIn } = await resolveSignalReadContext("metrics");
	if (isBuiltIn) return getMetricsConfig(params);

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
		}
		return { err: null, data: [{ ...emptyRow, services, metricNames }] };
	} catch (err) {
		return { err: facadeErrorMessage(err), data: [emptyRow] };
	}
}

/** Attribute-key discovery for the custom-filter builder. */
export async function getMetricAttributeKeysRecord(params: MetricParams) {
	const { adapter, isBuiltIn } = await resolveSignalReadContext("metrics");
	if (isBuiltIn) return getMetricAttributeKeys(params);

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
		return { ...empty, metricAttributeKeys: keys };
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
	const { adapter, isBuiltIn } = await resolveSignalReadContext("metrics");
	if (isBuiltIn) {
		return getMetricDetail(metricName, metricType, serviceName, params);
	}

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
	const { adapter, isBuiltIn } = await resolveSignalReadContext("metrics");
	if (isBuiltIn) return getSignalSummary(params, "metrics");

	const bucket = getSummaryBucket(params);
	const empty = { err: null, bucket, buckets: [], total: 0, peak: 0 };
	try {
		const query = metricParamsToOpenLITQuery(params, "metrics");
		const frame = await adapter.metricTimeSeries(query);
		const buckets = (frame.rows as unknown as Record<string, unknown>[]).map((row) => ({
			label: String(row.label ?? row.timestamp ?? row.request_time ?? ""),
			count: Number(row.count ?? 1),
			metrics: Number(row.metrics ?? 0),
			services: Number(row.services ?? 0),
		}));
		const total = buckets.reduce((sum, b) => sum + b.count, 0);
		const peak = buckets.reduce((max, b) => Math.max(max, b.count), 0);
		return { err: null, bucket, buckets, total, peak };
	} catch (err) {
		return { ...empty, err: facadeErrorMessage(err) };
	}
}
