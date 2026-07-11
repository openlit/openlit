/**
 * Prometheus / Mimir adapter (metrics).
 *
 * Queries PromQL via `GET /api/v1/query_range` (time series) and enumerates
 * metric names via `GET /api/v1/label/__name__/values`. Mimir exposes the same
 * Prometheus HTTP API, so this adapter serves both (registered under both
 * types). Tenanting via `X-Scope-OrgID` when a tenant credential is present.
 */

import { BaseExternalAdapter } from "../base-adapter";
import type {
	DataFrame,
	HealthCheckResult,
	NormalizedMetricPoint,
	OpenLITQuery,
	QueryTimeRange,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { applyHttpAuthCredentials } from "../http/auth-headers";
import { httpVendorFields } from "../config-fields";
import {
	computeIntervalMs,
	clampStepMs,
	intervalMsToSeconds,
	alignRangeToStep,
} from "../downsample";
import getMessage from "@/constants/messages";
import { safeFetch, selfHostedNetworkOptions } from "../http/safe-fetch";
import { cacheKey, cachedQuery } from "../http/cache";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";

const TTL_MS = 30_000;

export class PrometheusAdapter extends BaseExternalAdapter {
	readonly type: string;

	constructor(descriptor: TelemetrySourceDescriptor, type = "prometheus") {
		super(descriptor);
		this.type = type;
	}

	private get baseUrl(): string {
		return String(this.descriptor.settings.url || "").replace(/\/$/, "");
	}
	private get networkOpts() {
		return selfHostedNetworkOptions(this.descriptor.settings);
	}

	private async authHeaders() {
		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			this.descriptor.dbConfigId
		);
		return {
			headers: applyHttpAuthCredentials(secret.credentials, {
				tenantHeader: "X-Scope-OrgID",
			}),
			redact: redactableSecretValues(secret),
		};
	}

	capabilities(): SourceCapabilities {
		return {
			signals: ["metrics"],
			traceTree: false,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: true,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		try {
			const { headers, redact } = await this.authHeaders();
			await safeFetch(`${this.baseUrl}/api/v1/query?query=1`, {
				headers,
				...this.networkOpts,
				redactValues: redact,
				timeoutMs: 8000,
			});
			return { ok: true };
		} catch (err) {
			return { ok: false, message: String((err as Error)?.message || err) };
		}
	}

	private promExpr(query: OpenLITQuery): string {
		const named = query.filters?.find(
			(f) => f.target === "spanName" || f.key === "metric"
		)?.value;
		const metric = Array.isArray(named) ? named[0] : named;
		return String(metric || "up");
	}

	async listMetricSeries(
		query: OpenLITQuery
	): Promise<DataFrame<NormalizedMetricPoint>> {
		const start = Date.now();
		const { headers, redact } = await this.authHeaders();
		const stepSeconds = stepSecondsForQuery(query);
		// Align the range to the step so identical windows within a poll cycle
		// hash to the same cache key (Grafana rounds range to interval).
		const aligned = alignRangeToStep(query.timeRange, stepSeconds * 1000);
		const url = new URL(`${this.baseUrl}/api/v1/query_range`);
		url.searchParams.set("query", this.promExpr(query));
		url.searchParams.set("start", String(Math.floor(aligned.start.getTime() / 1000)));
		url.searchParams.set("end", String(Math.floor(aligned.end.getTime() / 1000)));
		url.searchParams.set("step", String(stepSeconds));
		const key = cacheKey(this.descriptor.id, ["range", url.toString()]);
		const response = await cachedQuery(key, TTL_MS, () =>
			safeFetch<{
				data?: {
					result?: {
						metric?: Record<string, string>;
						values?: [number, string][];
					}[];
				};
			}>(url.toString(), {
				headers,
				...this.networkOpts,
				redactValues: redact,
			})
		);
		const rows: NormalizedMetricPoint[] = [];
		for (const series of response?.data?.result || []) {
			const labels = series.metric || {};
			const name = labels.__name__ || this.promExpr(query);
			for (const [ts, value] of series.values || []) {
				rows.push({
					metricName: name,
					serviceName: labels.service_name || labels.job,
					timestamp: new Date(ts * 1000).toISOString(),
					value: Number(value) || 0,
					attributes: labels,
					resourceAttributes: {},
				});
			}
		}
		return { fields: [], rows, meta: { latencyMs: Date.now() - start } };
	}

	async metricTimeSeries(
		query: OpenLITQuery
	): Promise<DataFrame<NormalizedMetricPoint>> {
		return this.listMetricSeries(query);
	}

	async metricNames(window: QueryTimeRange): Promise<string[]> {
		const { headers, redact } = await this.authHeaders();
		const url = new URL(`${this.baseUrl}/api/v1/label/__name__/values`);
		url.searchParams.set(
			"start",
			String(Math.floor(window.start.getTime() / 1000))
		);
		url.searchParams.set("end", String(Math.floor(window.end.getTime() / 1000)));
		const response = await safeFetch<{ data?: string[] }>(url.toString(), {
			headers,
			...this.networkOpts,
			redactValues: redact,
		});
		return response?.data || [];
	}
}

/**
 * Pixel-bounded PromQL `step` in seconds. Derives the resolution from the range
 * and `maxDataPoints` (Grafana math) or an explicit interval, then clamps the
 * point count so a wide range never returns an unbounded series.
 */
function stepSecondsForQuery(query: OpenLITQuery): number {
	const rangeMs =
		query.timeRange.end.getTime() - query.timeRange.start.getTime();
	const stepMs = clampStepMs(rangeMs, computeIntervalMs(query));
	return intervalMsToSeconds(stepMs);
}

function promStyleDescriptor(
	type: string,
	displayName: string
): SourceTypeDescriptor {
	return {
		type,
		displayName,
		declaredSignals: ["metrics"],
		capabilities: {
			traceTree: false,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: true,
		},
		correlation: {
			crossSignal: false,
			keys: ["service"],
		},
		configFields: httpVendorFields({
			placeholder: "https://prometheus-prod-xxx.grafana.net/api/prom",
			tenant: true,
		}),
		authStyle: "http",
		authHelp: getMessage().DATA_SOURCE_AUTH_HELP_HTTP,
	};
}

export const prometheusAdapterFactory = {
	type: "prometheus",
	create: (descriptor: TelemetrySourceDescriptor) =>
		new PrometheusAdapter(descriptor, "prometheus"),
	describe: (): SourceTypeDescriptor =>
		promStyleDescriptor("prometheus", "Prometheus"),
};

export const mimirAdapterFactory = {
	type: "mimir",
	create: (descriptor: TelemetrySourceDescriptor) =>
		new PrometheusAdapter(descriptor, "mimir"),
	describe: (): SourceTypeDescriptor => promStyleDescriptor("mimir", "Grafana Mimir"),
};
