/**
 * New Relic DataSourceAdapter.
 *
 * Reads AI telemetry from New Relic via NerdGraph (GraphQL) running NRQL
 * against the `Span`, `Log` and `Metric` event types. The AI selector is
 * pushed down as an NRQL WHERE fragment; aggregation/discovery use NRQL
 * `FACET`. New Relic stores OTel span events as separate `Span` rows rather
 * than embedded events, so `spanEvents` is false and prompt/completion are
 * read from span attributes (the eval extractor is attribute-first). Cost is
 * surfaced as reported by the source; New Relic telemetry is read-only.
 */

import { BaseExternalAdapter } from "../base-adapter";
import type {
	AISignalValidation,
	DataFrame,
	DiscoveredService,
	HealthCheckResult,
	NormalizedLog,
	NormalizedMetricPoint,
	NormalizedSpan,
	OpenLITQuery,
	QueryTimeRange,
	ServiceRollup,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { UnsupportedCapabilityError } from "../types";
import { safeFetch } from "../http/safe-fetch";
import { cacheKey, cachedQuery } from "../http/cache";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";
import { newrelicAISelectorWhere } from "./selector";

const TTL_MS = 30_000;

/** A single NRQL result row (flat attribute bag). */
type NrqlRow = Record<string, unknown>;

export class NewRelicAdapter extends BaseExternalAdapter {
	readonly type = "newrelic";

	private get region(): string {
		return String(this.descriptor.settings.region || "US").toUpperCase();
	}
	private get accountId(): string {
		return String(this.descriptor.settings.accountId || "");
	}
	private get endpoint(): string {
		return this.region === "EU"
			? "https://api.eu.newrelic.com/graphql"
			: "https://api.newrelic.com/graphql";
	}

	private async authHeaders() {
		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			this.descriptor.dbConfigId
		);
		const apiKey = secret.credentials.apiKey || secret.raw;
		return {
			headers: {
				"Content-Type": "application/json",
				"API-Key": apiKey,
			},
			redact: redactableSecretValues(secret),
		};
	}

	capabilities(): SourceCapabilities {
		return {
			signals: this.descriptor.signals,
			traceTree: true,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: false,
		};
	}

	/** Run an NRQL query through NerdGraph and return the result rows. */
	private async nrql(query: string): Promise<NrqlRow[]> {
		if (!this.accountId) {
			throw new UnsupportedCapabilityError(
				this.type,
				"nrql",
				"New Relic source is missing accountId in settings."
			);
		}
		const { headers, redact } = await this.authHeaders();
		const graphql = {
			query: `query($id: Int!, $nrql: Nrql!) { actor { account(id: $id) { nrql(query: $nrql, timeout: 30) { results } } } }`,
			variables: { id: Number(this.accountId), nrql: query },
		};
		const key = cacheKey(this.descriptor.id, ["nrql", query]);
		const response = await cachedQuery(key, TTL_MS, () =>
			safeFetch<{
				data?: {
					actor?: {
						account?: { nrql?: { results?: NrqlRow[] } };
					};
				};
				errors?: { message?: string }[];
			}>(this.endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(graphql),
				redactValues: redact,
			})
		);
		if (response?.errors?.length) {
			throw new Error(
				`NerdGraph error: ${response.errors.map((e) => e.message).join("; ")}`
			);
		}
		return response?.data?.actor?.account?.nrql?.results || [];
	}

	private timeClause(window: QueryTimeRange): string {
		return `SINCE ${window.start.getTime()} UNTIL ${window.end.getTime()}`;
	}

	private whereClause(query: OpenLITQuery): string {
		const parts: string[] = [];
		if (query.aiSelector !== false) parts.push(newrelicAISelectorWhere());
		for (const f of query.filters || []) {
			if (f.target === "attribute" && f.key && f.op === "eq") {
				parts.push(`\`${f.key}\` = '${String(f.value).replace(/'/g, "\\'")}'`);
			}
		}
		return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const start = Date.now();
		try {
			await this.nrql("SELECT count(*) FROM Span SINCE 1 minutes ago LIMIT 1");
			return { ok: true, latencyMs: Date.now() - start };
		} catch (err) {
			return {
				ok: false,
				message: String((err as Error)?.message || err),
				latencyMs: Date.now() - start,
			};
		}
	}

	async validateAISignal(window: QueryTimeRange): Promise<AISignalValidation> {
		try {
			const rows = await this.nrql(
				`SELECT count(*) AS c FROM Span ${this.whereClause({
					signal: "traces",
					timeRange: window,
					aiSelector: true,
				})} ${this.timeClause(window)} LIMIT 1`
			);
			const count = Number((rows[0]?.c as number) || 0);
			return { ok: count > 0, sampleCount: count, missingAttributes: [] };
		} catch (err) {
			return {
				ok: false,
				sampleCount: 0,
				missingAttributes: [],
				message: String((err as Error)?.message || err),
			};
		}
	}

	private normalizeSpan(row: NrqlRow): NormalizedSpan {
		const spanAttributes: Record<string, string> = {};
		const resourceAttributes: Record<string, string> = {};
		const reserved = new Set([
			"trace.id",
			"id",
			"parent.id",
			"name",
			"timestamp",
			"duration.ms",
			"duration",
			"otel.status_code",
			"span.kind",
		]);
		for (const [k, v] of Object.entries(row)) {
			if (v === null || v === undefined) continue;
			if (reserved.has(k)) continue;
			if (
				k.startsWith("telemetry.") ||
				k.startsWith("service.") ||
				k.startsWith("deployment.") ||
				k.startsWith("k8s.") ||
				k === "entity.name" ||
				k === "entity.guid"
			) {
				resourceAttributes[k] = String(v);
			} else {
				spanAttributes[k] = String(v);
			}
		}
		const serviceName = String(
			row["service.name"] || row["entity.name"] || ""
		);
		if (serviceName) resourceAttributes["service.name"] = serviceName;
		const durationMs = Number(row["duration.ms"] ?? row.duration ?? 0);
		const costStr = spanAttributes["gen_ai.usage.cost"];
		return {
			traceId: String(row["trace.id"] || ""),
			spanId: String(row.id || ""),
			parentSpanId: String(row["parent.id"] || ""),
			name: String(row.name || ""),
			serviceName,
			timestamp: row.timestamp
				? new Date(Number(row.timestamp)).toISOString()
				: "",
			durationNs: Math.round(durationMs * 1e6),
			statusCode: String(row["otel.status_code"] || ""),
			spanKind: row["span.kind"] ? String(row["span.kind"]) : undefined,
			spanAttributes,
			resourceAttributes,
			events: [],
			cost: costStr !== undefined ? Number(costStr) || 0 : undefined,
		};
	}

	async listSpans(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		const start = Date.now();
		const limit = Math.min(query.limit || 100, 2000);
		const rows = await this.nrql(
			`SELECT * FROM Span ${this.whereClause(query)} ${this.timeClause(
				query.timeRange
			)} LIMIT ${limit}`
		);
		return {
			fields: [],
			rows: rows.map((r) => this.normalizeSpan(r)),
			meta: { latencyMs: Date.now() - start, rowsScanned: rows.length },
		};
	}

	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		const now = new Date();
		const rows = await this.nrql(
			`SELECT * FROM Span WHERE id = '${spanId.replace(
				/'/g,
				"\\'"
			)}' SINCE ${now.getTime() - 30 * 864e5} UNTIL ${now.getTime()} LIMIT 1`
		);
		return rows[0] ? this.normalizeSpan(rows[0]) : null;
	}

	async getTraceSpans(traceId: string): Promise<NormalizedSpan[]> {
		const now = new Date();
		const rows = await this.nrql(
			`SELECT * FROM Span WHERE \`trace.id\` = '${traceId.replace(
				/'/g,
				"\\'"
			)}' SINCE ${now.getTime() - 30 * 864e5} UNTIL ${now.getTime()} LIMIT 1000`
		);
		return rows.map((r) => this.normalizeSpan(r));
	}

	private nrqlAgg(fn: string, field?: string): string {
		const map: Record<string, string> = {
			count: "count(*)",
			sum: field ? `sum(\`${field}\`)` : "count(*)",
			avg: field ? `average(\`${field}\`)` : "count(*)",
			min: field ? `min(\`${field}\`)` : "count(*)",
			max: field ? `max(\`${field}\`)` : "count(*)",
			p50: field ? `percentile(\`${field}\`, 50)` : "count(*)",
			p90: field ? `percentile(\`${field}\`, 90)` : "count(*)",
			p95: field ? `percentile(\`${field}\`, 95)` : "count(*)",
			p99: field ? `percentile(\`${field}\`, 99)` : "count(*)",
			cardinality: field ? `uniqueCount(\`${field}\`)` : "count(*)",
		};
		return map[fn] || "count(*)";
	}

	async aggregateSpans(query: OpenLITQuery): Promise<DataFrame> {
		const start = Date.now();
		const selects = (query.aggregations || [{ fn: "count" as const }]).map(
			(a) => `${this.nrqlAgg(a.fn, a.field)} AS \`${a.as || a.fn}\``
		);
		const facet = (query.groupBy || []).map((g) => `\`${g}\``).join(", ");
		const facetClause = facet ? `FACET ${facet} LIMIT MAX` : "LIMIT 1";
		const rows = await this.nrql(
			`SELECT ${selects.join(", ")} FROM Span ${this.whereClause(
				query
			)} ${this.timeClause(query.timeRange)} ${facetClause}`
		);
		return { fields: [], rows, meta: { latencyMs: Date.now() - start } };
	}

	async spanTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		const start = Date.now();
		const selects = (query.aggregations || [{ fn: "count" as const }]).map(
			(a) => `${this.nrqlAgg(a.fn, a.field)} AS \`${a.as || a.fn}\``
		);
		const interval = query.interval || "1 minute";
		const rows = await this.nrql(
			`SELECT ${selects.join(", ")} FROM Span ${this.whereClause(
				query
			)} ${this.timeClause(query.timeRange)} TIMESERIES ${interval}`
		);
		return { fields: [], rows, meta: { latencyMs: Date.now() - start } };
	}

	async listLogs(query: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		const start = Date.now();
		const limit = Math.min(query.limit || 100, 2000);
		const rows = await this.nrql(
			`SELECT * FROM Log ${this.whereClause(query)} ${this.timeClause(
				query.timeRange
			)} LIMIT ${limit}`
		);
		const logs: NormalizedLog[] = rows.map((r) => {
			const logAttributes: Record<string, string> = {};
			for (const [k, v] of Object.entries(r)) {
				if (v === null || v === undefined) continue;
				if (["timestamp", "message", "level", "service.name"].includes(k))
					continue;
				logAttributes[k] = String(v);
			}
			return {
				timestamp: r.timestamp
					? new Date(Number(r.timestamp)).toISOString()
					: "",
				body: String(r.message || ""),
				severityText: r.level ? String(r.level) : undefined,
				serviceName: r["service.name"] ? String(r["service.name"]) : undefined,
				traceId: r["trace.id"] ? String(r["trace.id"]) : undefined,
				spanId: r["span.id"] ? String(r["span.id"]) : undefined,
				logAttributes,
				resourceAttributes: {},
			};
		});
		return { fields: [], rows: logs, meta: { latencyMs: Date.now() - start } };
	}

	async logTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		const start = Date.now();
		const interval = query.interval || "1 minute";
		const rows = await this.nrql(
			`SELECT count(*) AS c FROM Log ${this.whereClause(query)} ${this.timeClause(
				query.timeRange
			)} TIMESERIES ${interval}`
		);
		return { fields: [], rows, meta: { latencyMs: Date.now() - start } };
	}

	private metricName(query: OpenLITQuery): string {
		const named = query.filters?.find(
			(f) => f.target === "spanName" || f.key === "metric"
		)?.value;
		const metric = Array.isArray(named) ? named[0] : named;
		return String(metric || "");
	}

	async listMetricSeries(
		query: OpenLITQuery
	): Promise<DataFrame<NormalizedMetricPoint>> {
		const start = Date.now();
		const name = this.metricName(query);
		if (!name) {
			throw new UnsupportedCapabilityError(
				this.type,
				"listMetricSeries",
				"New Relic metric series requires a metric name filter."
			);
		}
		const interval = query.interval || "1 minute";
		const rows = await this.nrql(
			`SELECT average(\`${name}\`) AS value FROM Metric ${this.timeClause(
				query.timeRange
			)} TIMESERIES ${interval}`
		);
		const points: NormalizedMetricPoint[] = rows.map((r) => ({
			metricName: name,
			timestamp: r.beginTimeSeconds
				? new Date(Number(r.beginTimeSeconds) * 1000).toISOString()
				: r.timestamp
					? new Date(Number(r.timestamp)).toISOString()
					: "",
			value: Number(r.value) || 0,
			attributes: {},
			resourceAttributes: {},
		}));
		return { fields: [], rows: points, meta: { latencyMs: Date.now() - start } };
	}

	async metricTimeSeries(
		query: OpenLITQuery
	): Promise<DataFrame<NormalizedMetricPoint>> {
		return this.listMetricSeries(query);
	}

	async metricNames(window: QueryTimeRange): Promise<string[]> {
		const rows = await this.nrql(
			`SELECT uniques(metricName) AS names FROM Metric ${this.timeClause(
				window
			)} LIMIT 1`
		);
		const names = rows[0]?.names;
		return Array.isArray(names) ? names.map((n) => String(n)) : [];
	}

	async discoverServices(window: QueryTimeRange): Promise<DiscoveredService[]> {
		const rows = await this.nrql(
			`SELECT count(*) AS c FROM Span ${this.whereClause({
				signal: "traces",
				timeRange: window,
				aiSelector: true,
			})} ${this.timeClause(window)} FACET \`service.name\`, \`telemetry.sdk.name\`, \`telemetry.sdk.language\` LIMIT MAX`
		);
		return rows.map((r) => {
			const facet = (r.facet as unknown[]) || [];
			return {
				serviceName: String(facet[0] || r["service.name"] || ""),
				environment: "",
				clusterId: "",
				sdkName: facet[1] ? String(facet[1]) : undefined,
				sdkLanguage: facet[2] ? String(facet[2]) : undefined,
			};
		});
	}

	async aggregateByService(window: QueryTimeRange): Promise<ServiceRollup[]> {
		const rows = await this.nrql(
			`SELECT count(*) AS c, uniques(\`gen_ai.request.model\`) AS models, uniques(\`gen_ai.system\`) AS providers FROM Span ${this.whereClause(
				{ signal: "traces", timeRange: window, aiSelector: true }
			)} ${this.timeClause(window)} FACET \`service.name\` LIMIT MAX`
		);
		return rows.map((r) => {
			const facet = (r.facet as unknown[]) || [];
			return {
				serviceName: String(facet[0] || r["service.name"] || ""),
				environment: "",
				clusterId: "",
				requestCount: Number(r.c) || 0,
				models: Array.isArray(r.models) ? r.models.map((m) => String(m)) : [],
				providers: Array.isArray(r.providers)
					? r.providers.map((p) => String(p))
					: [],
			};
		});
	}

	async sampleTracesForGraph(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]> {
		const frame = await this.listSpans({
			...query,
			limit: Math.min((maxTraces || 100) * 20, 2000),
		});
		return frame.rows;
	}
}

export const newrelicAdapterFactory = {
	type: "newrelic",
	create: (descriptor: TelemetrySourceDescriptor) =>
		new NewRelicAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "newrelic",
		displayName: "New Relic",
		declaredSignals: ["traces", "logs", "metrics"],
		capabilities: {
			traceTree: true,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: {
			crossSignal: true,
			keys: ["traceId", "spanId", "service"],
		},
	}),
};
