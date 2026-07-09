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
import { safeFetch } from "../http/safe-fetch";
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
	private get allowHttp(): boolean {
		return this.descriptor.settings.allowHttp !== false;
	}

	private async authHeaders() {
		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			this.descriptor.dbConfigId
		);
		const headers: Record<string, string> = {};
		if (secret.credentials.token) {
			headers.Authorization = `Bearer ${secret.credentials.token}`;
		} else if (secret.credentials.username) {
			const basic = Buffer.from(
				`${secret.credentials.username}:${secret.credentials.password || ""}`
			).toString("base64");
			headers.Authorization = `Basic ${basic}`;
		}
		if (secret.credentials.tenant) {
			headers["X-Scope-OrgID"] = secret.credentials.tenant;
		}
		return { headers, redact: redactableSecretValues(secret) };
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
				allowHttp: this.allowHttp,
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
		const url = new URL(`${this.baseUrl}/api/v1/query_range`);
		url.searchParams.set("query", this.promExpr(query));
		url.searchParams.set(
			"start",
			String(Math.floor(query.timeRange.start.getTime() / 1000))
		);
		url.searchParams.set(
			"end",
			String(Math.floor(query.timeRange.end.getTime() / 1000))
		);
		url.searchParams.set("step", stepForInterval(query.interval));
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
				allowHttp: this.allowHttp,
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
			allowHttp: this.allowHttp,
			redactValues: redact,
		});
		return response?.data || [];
	}
}

function stepForInterval(interval?: string): string {
	if (!interval) return "60";
	const m = interval.match(/^(\d+)([smhd])$/);
	if (!m) return "60";
	const n = Number(m[1]);
	const unit = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]] || 60;
	return String(n * unit);
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
