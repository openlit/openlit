/**
 * External-metrics path for GPU dashboard widgets.
 * Built-in ClickHouse keeps SQL in sibling modules; this routes through the
 * metrics signal binding so Prometheus / Mimir / etc. can serve gpu.* gauges.
 */

import type { GPUMetricParams } from "@/lib/platform/common";
import { metricParamsToOpenLITQuery } from "@/lib/platform/connectors/datasource/clickhouse/query-map";
import type { OpenLITQuery } from "@/lib/platform/connectors/datasource/types";

async function resolveExternalMetrics(environment?: string) {
	const { getTelemetryAdapter, resolveTelemetrySourceDescriptor } =
		await import("@/lib/telemetry-source");
	const descriptor = await resolveTelemetrySourceDescriptor({
		signal: "metrics",
		environment,
	});
	if (descriptor.isBuiltIn || descriptor.type === "clickhouse") {
		return null;
	}
	const adapter = await getTelemetryAdapter({ signal: "metrics", environment });
	return { adapter, descriptor };
}

function asError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function gpuMetricQuery(
	params: GPUMetricParams,
	metricNames: string[],
	aggregations?: OpenLITQuery["aggregations"]
): OpenLITQuery {
	const base = metricParamsToOpenLITQuery(params, "metrics");
	return {
		...base,
		filters: [
			...(base.filters || []),
			{ target: "spanName", op: "in", value: metricNames },
		],
		aggregations,
	};
}

function averageOf(rows: Record<string, unknown>[]): number {
	const values = rows
		.map((row) => Number(row.value ?? row.count ?? 0))
		.filter((value) => Number.isFinite(value));
	if (values.length === 0) return 0;
	return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function bucketByTime(
	rows: Record<string, unknown>[],
	valueKey: string
): Array<Record<string, unknown>> {
	const buckets = new Map<string, number[]>();
	for (const row of rows) {
		const label = String(row.request_time ?? row.timestamp ?? row.label ?? "");
		if (!label) continue;
		const value = Number(row.value ?? 0);
		if (!Number.isFinite(value)) continue;
		const list = buckets.get(label) || [];
		list.push(value);
		buckets.set(label, list);
	}
	return Array.from(buckets.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([request_time, values]) => ({
			request_time,
			[valueKey]:
				Math.round(
					(values.reduce((sum, value) => sum + value, 0) / values.length) * 100
				) / 100,
		}));
}

async function externalGpuAverage(
	params: GPUMetricParams,
	metricName: string,
	valueKey: string
) {
	const resolved = await resolveExternalMetrics(params.environment);
	if (!resolved) return null;
	try {
		const frame = await resolved.adapter.metricTimeSeries(
			gpuMetricQuery(params, [metricName], [{ fn: "avg", as: valueKey }])
		);
		return {
			err: null,
			data: [{ [valueKey]: averageOf(frame.rows as unknown as Record<string, unknown>[]) }],
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}

async function externalGpuSeries(
	params: GPUMetricParams,
	metricNames: string[],
	mapName: (metricName: string) => string
) {
	const resolved = await resolveExternalMetrics(params.environment);
	if (!resolved) return null;
	try {
		const frame = await resolved.adapter.metricTimeSeries(
			gpuMetricQuery(params, metricNames, [{ fn: "avg", as: "value" }])
		);
		const byTime = new Map<string, Record<string, unknown>>();
		for (const row of frame.rows as unknown as Record<string, unknown>[]) {
			const request_time = String(
				row.request_time ?? row.timestamp ?? row.label ?? ""
			);
			if (!request_time) continue;
			const metricName = String(row.metricName ?? row.__name__ ?? "");
			const key = mapName(metricName);
			const value = Number(row.value ?? 0);
			if (!key || !Number.isFinite(value)) continue;
			const bucket = byTime.get(request_time) || { request_time };
			bucket[key] = value;
			byTime.set(request_time, bucket);
		}
		return {
			err: null,
			data: Array.from(byTime.values()).sort((a, b) =>
				String(a.request_time).localeCompare(String(b.request_time))
			),
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}

export async function externalAverageUtilization(params: GPUMetricParams) {
	return externalGpuAverage(params, "gpu.utilization", "utilization");
}

export async function externalUtilizationParamsPerTime(params: GPUMetricParams) {
	return externalGpuSeries(
		params,
		["gpu.utilization", "gpu.enc.utilization", "gpu.dec.utilization"],
		(name) => name.replace(/^gpu\./, "").replaceAll(".", "_")
	);
}

export async function externalAverageTemperature(params: GPUMetricParams) {
	return externalGpuAverage(params, "gpu.temperature", "temperature");
}

export async function externalAverageTemperatureParamsPerTime(
	params: GPUMetricParams
) {
	const resolved = await resolveExternalMetrics(params.environment);
	if (!resolved) return null;
	try {
		const frame = await resolved.adapter.metricTimeSeries(
			gpuMetricQuery(params, ["gpu.temperature"], [{ fn: "avg", as: "temperature" }])
		);
		return {
			err: null,
			data: bucketByTime(frame.rows as unknown as Record<string, unknown>[], "temperature"),
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}

export async function externalAveragePowerDraw(params: GPUMetricParams) {
	return externalGpuAverage(params, "gpu.power.draw", "power_draw");
}

export async function externalPowerParamsPerTime(params: GPUMetricParams) {
	return externalGpuSeries(
		params,
		["gpu.power.draw", "gpu.power.limit"],
		(name) => name.replace(/^gpu\./, "").replaceAll(".", "_")
	);
}

export async function externalAverageMemoryUsage(params: GPUMetricParams) {
	return externalGpuAverage(params, "gpu.memory.used", "memory_used");
}

export async function externalMemoryParamsPerTime(params: GPUMetricParams) {
	return externalGpuSeries(
		params,
		[
			"gpu.memory.available",
			"gpu.memory.total",
			"gpu.memory.used",
			"gpu.memory.free",
		],
		(name) => name.replace(/^gpu\./, "").replaceAll(".", "_")
	);
}

export async function externalFanspeedParamsPerTime(params: GPUMetricParams) {
	const resolved = await resolveExternalMetrics(params.environment);
	if (!resolved) return null;
	try {
		const frame = await resolved.adapter.metricTimeSeries(
			gpuMetricQuery(params, ["gpu.fan_speed"], [{ fn: "avg", as: "fan_speed" }])
		);
		return {
			err: null,
			data: bucketByTime(frame.rows as unknown as Record<string, unknown>[], "fan_speed"),
		};
	} catch (err) {
		return { err: asError(err), data: [] };
	}
}
