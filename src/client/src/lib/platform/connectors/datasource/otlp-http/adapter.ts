/**
 * Generic OTLP/HTTP DataSourceAdapter (traces MVP).
 *
 * The universal fallback connector: binds traces to any
 * backend exposing OTLP JSON over HTTP - collectors, gateways, or bespoke OTel
 * pipelines. HTTP transport is OpenLIT's guarded safeFetch (SSRF-safe,
 * default-deny), credentials resolve from the project vault, and payloads are
 * normalized with the shared vendor-neutral otlp-json parser.
 *
 * OTLP is a push protocol with no standardized query API, so the read contract
 * is conventional and the paths are configurable: GET <tracesPath> (time range +
 * limit/offset) and GET <tracesPath>/{traceId}, both returning OTLP JSON.
 */

import { BaseExternalAdapter } from "../base-adapter";
import type {
	DataFrame,
	HealthCheckResult,
	NormalizedSpan,
	OpenLITQuery,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { applyHttpAuthCredentials } from "../http/auth-headers";
import { httpVendorFields } from "../config-fields";
import type { FieldDef } from "../types";
import getMessage from "@/constants/messages";
import {
	safeFetch,
	selfHostedNetworkOptions,
	SourceResponseError,
} from "../http/safe-fetch";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";
import { normalizeOtlpId, parseOtlpTrace } from "../otlp-json";
import { spanMatchesFilters, traceMatchesAISelector } from "../selector-match";

const HEALTH_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 15_000;
const SPAN_INDEX_MAX = 5_000;
const ZERO_PARENT = new Set(["", "0".repeat(16), "0".repeat(32)]);

/** Bounded per-source span index for detail navigation (same shape as Jaeger). */
const spanIndexBySource = new Map<string, Map<string, NormalizedSpan>>();

function rememberSpans(sourceId: string, spans: NormalizedSpan[]): void {
	let index = spanIndexBySource.get(sourceId);
	if (!index) {
		index = new Map();
		spanIndexBySource.set(sourceId, index);
	}
	for (const span of spans) {
		if (!span.spanId) continue;
		if (index.size >= SPAN_INDEX_MAX) {
			const oldest = index.keys().next().value;
			if (oldest) index.delete(oldest);
		}
		index.set(span.spanId, span);
	}
}

function pickRootSpan(spans: NormalizedSpan[]): NormalizedSpan | undefined {
	if (spans.length === 0) return undefined;
	const ids = new Set(spans.map((s) => s.spanId));
	const explicit =
		spans.find((s) => ZERO_PARENT.has(s.parentSpanId || "")) ||
		spans.find((s) => s.parentSpanId && !ids.has(s.parentSpanId));
	if (explicit) return explicit;
	return [...spans].sort((a, b) => {
		const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
		const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
		return ta - tb;
	})[0];
}

function summarizeTrace(spans: NormalizedSpan[]): NormalizedSpan["traceSummary"] {
	let errorCount = 0;
	let earliest = "";
	let latestEnd = 0;
	for (const span of spans) {
		if (/error/i.test(span.statusCode || "")) errorCount += 1;
		if (span.timestamp && (!earliest || span.timestamp < earliest))
			earliest = span.timestamp;
		const startMs = span.timestamp ? new Date(span.timestamp).getTime() : 0;
		const endMs = startMs + (span.durationNs || 0) / 1e6;
		if (endMs > latestEnd) latestEnd = endMs;
	}
	const startMs = earliest ? new Date(earliest).getTime() : 0;
	return {
		spanCount: spans.length,
		errorCount,
		...(latestEnd > startMs
			? { durationNs: Math.round((latestEnd - startMs) * 1e6) }
			: {}),
		...(earliest ? { start: earliest } : {}),
		...(errorCount > 0 ? { statusCode: "STATUS_CODE_ERROR" } : {}),
	};
}

/**
 * Accept the payload shapes OTLP HTTP query backends plausibly return: a single
 * OTLP trace payload, a list of payloads, or { traces: [...] }.
 */
function normalizeConfigPath(raw: string, key: string): string {
	if (raw.includes("?")) {
		throw new Error(
			`otlp-http: ${key} must be a URL path without a query string (got "${raw}")`
		);
	}
	return raw.startsWith("/") ? raw : `/${raw}`;
}

function spansFromPayload(payload: unknown): NormalizedSpan[] {
	const isOtlpTrace = (value: unknown): boolean => {
		if (!value || typeof value !== "object") return false;
		const trace = value as { resourceSpans?: unknown; batches?: unknown };
		return Array.isArray(trace.resourceSpans) || Array.isArray(trace.batches);
	};
	let spans: NormalizedSpan[];
	if (Array.isArray(payload)) {
		if (!payload.every(isOtlpTrace)) {
			throw new Error(
				"otlp-http: endpoint did not return OTLP JSON (array entries must be OTLP trace payloads)"
			);
		}
		spans = payload.flatMap((entry) => parseOtlpTrace(entry));
	} else if (
		payload !== null &&
		typeof payload === "object" &&
		Array.isArray((payload as { traces?: unknown[] }).traces)
	) {
		spans = (payload as { traces: unknown[] }).traces.flatMap((entry) =>
			parseOtlpTrace(entry)
		);
	} else if (isOtlpTrace(payload)) {
		spans = parseOtlpTrace(payload);
	} else {
		throw new Error(
			"otlp-http: endpoint did not return OTLP JSON (expected resourceSpans or a traces array)"
		);
	}
	// Spans without a trace id cannot be grouped, navigated, or correlated.
	return spans.filter((span) => !!span.traceId);
}

/** Group spans by trace id, preserving first-seen order. */
function groupByTrace(spans: NormalizedSpan[]): Map<string, NormalizedSpan[]> {
	const byTrace = new Map<string, NormalizedSpan[]>();
	for (const span of spans) {
		const key = span.traceId || "";
		const group = byTrace.get(key);
		if (group) group.push(span);
		else byTrace.set(key, [span]);
	}
	return byTrace;
}

export class OtlpHttpAdapter extends BaseExternalAdapter {
	readonly type = "otlp-http";

	private get baseUrl(): string {
		return String(this.descriptor.settings.url || "").replace(/\/$/, "");
	}
	private get networkOpts() {
		return selfHostedNetworkOptions(this.descriptor.settings);
	}
	private get tracesEnabled(): boolean {
		return this.descriptor.settings.tracesEnabled !== false;
	}
	private get tracesPath(): string {
		return normalizeConfigPath(
			String(this.descriptor.settings.tracesPath || "/v1/traces"),
			"tracesPath"
		);
	}
	private get healthPath(): string {
		return normalizeConfigPath(
			String(this.descriptor.settings.healthPath || "/"),
			"healthPath"
		);
	}

	private async authHeaders() {
		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			this.descriptor.dbConfigId,
			this.descriptor.projectId
		);
		const headers = applyHttpAuthCredentials(secret.credentials, {
			authType: this.descriptor.settings.authType as string | undefined,
		});
		// API-key auth is connector-local: a password credential plus an optional
		// header name, no shared auth changes.
		const apiKey = secret.credentials.apiKey?.trim();
		if (apiKey) {
			const headerName =
				String(this.descriptor.settings.apiKeyHeader || "").trim() || "X-API-Key";
			headers[headerName] = apiKey;
		}
		return { headers, redact: redactableSecretValues(secret) };
	}

	private async get<T>(
		path: string,
		timeoutMs: number,
		concurrencyKey?: string
	): Promise<T> {
		const { headers, redact } = await this.authHeaders();
		return safeFetch<T>(`${this.baseUrl}${path}`, {
			method: "GET",
			headers,
			...this.networkOpts,
			redactValues: redact,
			timeoutMs,
			concurrencyKey: concurrencyKey ?? this.descriptor.id,
			retry: true,
		});
	}

	capabilities(): SourceCapabilities {
		const signals: SourceCapabilities["signals"] = [];
		if (this.tracesEnabled) signals.push("traces");
		// Traces only for now; logs/metrics support is not implemented and the
		// descriptor does not advertise it.
		return {
			signals,
			traceTree: this.tracesEnabled,
			spanEvents: this.tracesEnabled,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const start = Date.now();
		try {
			await this.get<unknown>(
				this.healthPath,
				HEALTH_TIMEOUT_MS,
				`${this.descriptor.id}:health`
			);
			return { ok: true, latencyMs: Date.now() - start };
		} catch (error) {
			if (error instanceof SourceResponseError) {
				// A 405 means something HTTP is listening but wants another method:
				// the endpoint is reachable, which is what Test Connection promises.
				if (error.status === 405) {
					return {
						ok: true,
						message: "Endpoint reachable (405 Method Not Allowed on GET).",
						latencyMs: Date.now() - start,
					};
				}
				if (error.status === 401 || error.status === 403) {
					return {
						ok: false,
						message: `Authentication failed (HTTP ${error.status}). Check the configured credentials.`,
						latencyMs: Date.now() - start,
					};
				}
				if (error.status === 404) {
					return {
						ok: false,
						message: "Health path returned 404. Check the base URL or set a different health path.",
						latencyMs: Date.now() - start,
					};
				}
				return {
					ok: false,
					message: `HTTP ${error.status}: ${error.message}`,
					latencyMs: Date.now() - start,
				};
			}
			return {
				ok: false,
				message: String((error as Error)?.message || error),
				latencyMs: Date.now() - start,
			};
		}
	}

	async listSpans(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		const start = Date.now();
		const limit = Math.max(1, Math.min(query.limit || 25, 200));
		const offset = Math.max(0, query.offset || 0);
		const params = new URLSearchParams({
			start: query.timeRange.start.toISOString(),
			end: query.timeRange.end.toISOString(),
			limit: String(limit),
			offset: String(offset),
		});
		const payload = await this.get<unknown>(
			`${this.tracesPath}?${params.toString()}`,
			QUERY_TIMEOUT_MS
		);
		const spans = spansFromPayload(payload);
		rememberSpans(this.descriptor.id, spans);
		// In-process filtering, same contract as Jaeger: the AI selector keeps a
		// trace when any span matches, and user filters keep a trace when any
		// span satisfies every filter.
		const rows: NormalizedSpan[] = [];
		for (const traceSpans of Array.from(groupByTrace(spans).values())) {
			if (query.aiSelector !== false && !traceMatchesAISelector(traceSpans)) {
				continue;
			}
			if (
				query.filters?.length &&
				!traceSpans.some((span) => spanMatchesFilters(span, query.filters))
			) {
				continue;
			}
			const root = pickRootSpan(traceSpans);
			if (!root) continue;
			rows.push({ ...root, traceSummary: summarizeTrace(traceSpans) });
		}
		// `limit` counts trace groups (what the UI renders), not raw spans.
		return {
			fields: [],
			rows: rows.slice(0, limit),
			meta: {
				latencyMs: Date.now() - start,
				truncated: rows.length > limit,
				degraded: ["serverAggregation"],
			},
		};
	}

	async getTraceSpans(traceId: string): Promise<NormalizedSpan[]> {
		const payload = await this.get<unknown>(
			`${this.tracesPath}/${encodeURIComponent(traceId)}`,
			QUERY_TIMEOUT_MS
		);
		const wanted = normalizeOtlpId(traceId);
		const spans = spansFromPayload(payload).filter(
			(span) => normalizeOtlpId(span.traceId) === wanted
		);
		rememberSpans(this.descriptor.id, spans);
		return spans;
	}

	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		return spanIndexBySource.get(this.descriptor.id)?.get(spanId) ?? null;
	}
}

const signalToggleFields: FieldDef[] = [
	{
		key: "tracesEnabled",
		label: "Traces",
		kind: "switch",
		group: "settings",
		description: "Read traces from this endpoint (OTLP JSON).",
		defaultValue: true,
	},
];

const pathFields: FieldDef[] = [
	{
		key: "tracesPath",
		label: "Traces query path",
		kind: "text",
		group: "settings",
		placeholder: "/v1/traces",
		description: "GET <path>?start&end&limit&offset and GET <path>/{traceId}, OTLP JSON.",
		defaultValue: "/v1/traces",
	},
	{
		key: "healthPath",
		label: "Health check path",
		kind: "text",
		group: "settings",
		placeholder: "/",
		description: "GET path probed by Test Connection; 405 counts as reachable.",
		defaultValue: "/",
	},
];

const apiKeyFields: FieldDef[] = [
	{
		key: "apiKey",
		label: "API key",
		kind: "password",
		group: "credentials",
		description: "Sent as a request header when set.",
	},
	{
		key: "apiKeyHeader",
		label: "API key header",
		kind: "text",
		group: "settings",
		placeholder: "X-API-Key",
		defaultValue: "X-API-Key",
	},
];

export const otlpHttpAdapterFactory = {
	type: "otlp-http",
	create: (descriptor: TelemetrySourceDescriptor) => new OtlpHttpAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "otlp-http",
		displayName: "Generic OTLP HTTP",
		description: "Traces from any backend exposing OTLP JSON over HTTP.",
		declaredSignals: ["traces"],
		capabilities: {
			traceTree: true,
			spanEvents: true,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: {
			crossSignal: false,
			keys: ["traceId", "spanId", "service"],
		},
		configFields: [
			...httpVendorFields({ placeholder: "https://collector.example.com" }),
			...signalToggleFields,
			...pathFields,
			...apiKeyFields,
		],
		authStyle: "http",
		authHelp: getMessage().DATA_SOURCE_AUTH_HELP_HTTP,
	}),
};
