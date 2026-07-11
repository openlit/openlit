/**
 * Parse OTLP/JSON trace payloads into NormalizedSpan[].
 *
 * Tempo (`GET /api/traces/{id}`) and Jaeger v3 (`GET /api/v3/traces/{id}`)
 * both return OTLP/JSON: a top-level `batches` (or `resourceSpans`) array,
 * each with a `resource.attributes` list and `scopeSpans`/`instrumentationLibrarySpans`
 * holding spans. Attribute values are the OTLP AnyValue shape
 * (`{ stringValue | intValue | doubleValue | boolValue }`).
 */

import type { NormalizedSpan, NormalizedSpanEvent } from "./types";

interface OtlpAnyValue {
	stringValue?: string;
	intValue?: string | number;
	doubleValue?: number;
	boolValue?: boolean;
	arrayValue?: { values?: OtlpAnyValue[] };
}

interface OtlpKeyValue {
	key: string;
	value?: OtlpAnyValue;
}

interface OtlpSpan {
	traceId?: string;
	spanId?: string;
	parentSpanId?: string;
	name?: string;
	kind?: string | number;
	startTimeUnixNano?: string | number;
	endTimeUnixNano?: string | number;
	attributes?: OtlpKeyValue[];
	status?: { code?: string | number; message?: string };
	events?: {
		name?: string;
		timeUnixNano?: string | number;
		attributes?: OtlpKeyValue[];
	}[];
}

interface OtlpScopeSpans {
	spans?: OtlpSpan[];
}

interface OtlpResourceSpans {
	resource?: { attributes?: OtlpKeyValue[] };
	scopeSpans?: OtlpScopeSpans[];
	instrumentationLibrarySpans?: OtlpScopeSpans[];
}

interface OtlpTrace {
	batches?: OtlpResourceSpans[];
	resourceSpans?: OtlpResourceSpans[];
}

function anyValueToString(v?: OtlpAnyValue): string {
	if (!v) return "";
	if (v.stringValue !== undefined) return v.stringValue;
	if (v.intValue !== undefined) return String(v.intValue);
	if (v.doubleValue !== undefined) return String(v.doubleValue);
	if (v.boolValue !== undefined) return String(v.boolValue);
	if (v.arrayValue?.values) {
		return JSON.stringify(v.arrayValue.values.map(anyValueToString));
	}
	return "";
}

function attrsToMap(attrs?: OtlpKeyValue[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const kv of attrs || []) {
		if (kv.key) out[kv.key] = anyValueToString(kv.value);
	}
	return out;
}

function nanoToIso(nano?: string | number): string {
	if (nano === undefined) return "";
	const ns = typeof nano === "string" ? Number(nano) : nano;
	if (!Number.isFinite(ns)) return "";
	return new Date(ns / 1e6).toISOString();
}

function durationNs(
	start?: string | number,
	end?: string | number
): number {
	const s = Number(start);
	const e = Number(end);
	if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
	return Math.max(0, e - s);
}

function statusCode(code?: string | number): string {
	if (code === undefined) return "";
	// OTLP status: 0 UNSET, 1 OK, 2 ERROR
	if (code === 2 || code === "STATUS_CODE_ERROR" || code === "ERROR")
		return "STATUS_CODE_ERROR";
	if (code === 1 || code === "STATUS_CODE_OK" || code === "OK")
		return "STATUS_CODE_OK";
	return String(code);
}

function normalizeEvents(span: OtlpSpan): NormalizedSpanEvent[] {
	return (span.events || []).map((e) => ({
		name: e.name || "",
		timestamp: e.timeUnixNano ? nanoToIso(e.timeUnixNano) : undefined,
		attributes: attrsToMap(e.attributes),
	}));
}

/**
 * Tempo `/api/traces/{id}` often encodes binary IDs as base64 in OTLP/JSON,
 * while TraceQL search and `/api/traces/{hex}` expect lowercase hex. Normalize
 * so list rows, detail lookups, and TraceQL `{ span:id = … }` stay aligned.
 */
export function normalizeOtlpId(raw?: string): string {
	if (!raw) return "";
	const value = String(raw).trim();
	if (!value) return "";
	if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
		return value.toLowerCase();
	}
	try {
		const buf = Buffer.from(value, "base64");
		if (buf.length === 8 || buf.length === 16) {
			return buf.toString("hex");
		}
	} catch {
		// keep original
	}
	return value;
}

/** Parse an OTLP/JSON trace payload into normalized spans. */
export function parseOtlpTrace(payload: unknown): NormalizedSpan[] {
	const trace = (payload || {}) as OtlpTrace;
	const resourceSpans = trace.batches || trace.resourceSpans || [];
	const out: NormalizedSpan[] = [];
	for (const rs of resourceSpans) {
		const resourceAttributes = attrsToMap(rs.resource?.attributes);
		const serviceName = resourceAttributes["service.name"] || "";
		const scopes = rs.scopeSpans || rs.instrumentationLibrarySpans || [];
		for (const scope of scopes) {
			for (const span of scope.spans || []) {
				out.push({
					traceId: normalizeOtlpId(span.traceId),
					spanId: normalizeOtlpId(span.spanId),
					parentSpanId: normalizeOtlpId(span.parentSpanId),
					name: String(span.name || ""),
					serviceName,
					timestamp: nanoToIso(span.startTimeUnixNano),
					durationNs: durationNs(span.startTimeUnixNano, span.endTimeUnixNano),
					statusCode: statusCode(span.status?.code),
					statusMessage: span.status?.message,
					spanKind: span.kind !== undefined ? String(span.kind) : undefined,
					spanAttributes: attrsToMap(span.attributes),
					resourceAttributes,
					events: normalizeEvents(span),
				});
			}
		}
	}
	return out;
}
