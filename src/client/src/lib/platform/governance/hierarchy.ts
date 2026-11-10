import type { TraceHeirarchySpan, TraceRow } from "@/types/trace";

const RULE_FIELD_NAMES = [
	"ServiceName",
	"SpanName",
	"SpanKind",
	"StatusCode",
	"deployment.environment",
	"service.name",
	"gen_ai.system",
	"gen_ai.request.model",
	"gen_ai.usage.input_tokens",
	"gen_ai.usage.output_tokens",
	"gen_ai.usage.total_cost",
	"gen_ai.request.temperature",
	"gen_ai.tool.name",
	"gen_ai.tool.call.name",
	"coding_agent.client",
	"coding_agent.policy.permission_mode",
	"coding_agent.content_capture_mode",
	"coding_agent.user.classification",
	"coding_agent.session.outcome",
	"coding_agent.tool.name",
] as const;

function ruleFieldValue(row: TraceRow, field: string): string {
	const attributeFields: Record<
		string,
		["SpanAttributes" | "ResourceAttributes", string]
	> = {
		"service.name": ["ResourceAttributes", "service.name"],
		"gen_ai.system": ["SpanAttributes", "gen_ai.system"],
		"gen_ai.request.model": ["SpanAttributes", "gen_ai.request.model"],
		"gen_ai.usage.input_tokens": ["SpanAttributes", "gen_ai.usage.input_tokens"],
		"gen_ai.usage.output_tokens": ["SpanAttributes", "gen_ai.usage.output_tokens"],
		"gen_ai.usage.total_cost": ["SpanAttributes", "gen_ai.usage.total_cost"],
		"gen_ai.request.temperature": ["SpanAttributes", "gen_ai.request.temperature"],
		"gen_ai.tool.name": ["SpanAttributes", "gen_ai.tool.name"],
		"gen_ai.tool.call.name": ["SpanAttributes", "gen_ai.tool.call.name"],
		"coding_agent.client": ["SpanAttributes", "coding_agent.client"],
		"coding_agent.policy.permission_mode": [
			"SpanAttributes",
			"coding_agent.policy.permission_mode",
		],
		"coding_agent.content_capture_mode": [
			"SpanAttributes",
			"coding_agent.content_capture_mode",
		],
		"coding_agent.user.classification": [
			"SpanAttributes",
			"coding_agent.user.classification",
		],
		"coding_agent.session.outcome": [
			"SpanAttributes",
			"coding_agent.session.outcome",
		],
		"coding_agent.tool.name": ["SpanAttributes", "coding_agent.tool.name"],
	};
	// Prefer SpanAttributes, then ResourceAttributes for coding-agent / capture mode.
	if (
		field.startsWith("coding_agent.") ||
		field === "gen_ai.tool.name" ||
		field === "gen_ai.tool.call.name"
	) {
		return String(
			row.SpanAttributes[field] ?? row.ResourceAttributes[field] ?? ""
		);
	}
	if (field === "deployment.environment") {
		return String(
			row.ResourceAttributes["deployment.environment"] ??
				row.SpanAttributes["deployment.environment"] ??
				row.SpanAttributes["gen_ai.environment"] ??
				""
		);
	}
	const attribute = attributeFields[field];
	if (attribute) {
		const [scope, key] = attribute;
		return String(row[scope][key] ?? "");
	}
	const directFields: Record<string, string> = {
		ServiceName: row.ServiceName,
		SpanName: row.SpanName,
		SpanKind: row.SpanKind,
		Duration: row.Duration,
		StatusCode: row.StatusCode,
	};
	return String(directFields[field] ?? "");
}

function parseTimestamp(value?: string | Date): Date {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
	if (typeof value === "string" && value) {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return new Date(0);
}

function stringRecord(
	source?: Record<string, string | number>
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(source || {}).map(([key, value]) => [key, String(value)])
	);
}

export function flattenHierarchy(span: TraceHeirarchySpan): TraceHeirarchySpan[] {
	return [span, ...(span.children || []).flatMap(flattenHierarchy)];
}

export function hierarchySpanToTraceRow(span: TraceHeirarchySpan): TraceRow {
	return {
		Timestamp: parseTimestamp(span.Timestamp),
		TraceId: span.TraceId || "",
		SpanId: span.SpanId,
		ParentSpanId: span.ParentSpanId || "",
		TraceState: "",
		SpanName: span.SpanName,
		SpanKind: span.SpanKind || "SPAN_KIND_INTERNAL",
		ServiceName: span.ServiceName || "",
		ResourceAttributes: stringRecord(span.ResourceAttributes),
		ScopeName: span.ScopeName || "",
		ScopeVersion: span.ScopeVersion || "",
		SpanAttributes: span.SpanAttributes || {},
		Duration: String(span.Duration || ""),
		StatusCode: span.StatusCode || "",
		StatusMessage: span.StatusMessage || "",
		Events: (span.Events || []).map((event) => ({
			Timestamp: parseTimestamp(event.Timestamp),
			Name: event.Name || "",
			Attributes: stringRecord(event.Attributes),
		})),
		Links: (span.Links || []).map((link) => ({
			TraceId: link.TraceId || "",
			SpanId: link.SpanId || "",
			TraceState: link.TraceState || "",
			Attributes: stringRecord(link.Attributes),
		})),
	};
}

/** Fields aligned with rule-engine field discovery (`getRuleTraceFieldValue`). */
export function ruleFieldsFromHierarchySpan(
	span: TraceHeirarchySpan
): Record<string, string | number | boolean> {
	const row = hierarchySpanToTraceRow(span);
	const fields: Record<string, string | number | boolean> = {};
	for (const field of RULE_FIELD_NAMES) {
		const value = ruleFieldValue(row, field);
		if (!value) continue;
		if (field === "gen_ai.usage.input_tokens" || field === "gen_ai.usage.output_tokens") {
			const numeric = Number(value);
			if (Number.isFinite(numeric)) fields[field] = numeric;
			continue;
		}
		if (field === "gen_ai.usage.total_cost" || field === "gen_ai.request.temperature") {
			const numeric = Number(value);
			if (Number.isFinite(numeric)) fields[field] = numeric;
			continue;
		}
		fields[field] = value;
	}
	return fields;
}

export function spanDurationMs(span: TraceHeirarchySpan): number {
	const value = Number(span.Duration);
	if (!Number.isFinite(value)) return 0;
	if (value > 1_000_000) return value / 1e6;
	if (value > 10_000) return value / 1e3;
	return value;
}

export function readSpanAttr(
	span: TraceHeirarchySpan,
	keys: string[]
): string {
	const sources = [span.SpanAttributes, span.ResourceAttributes];
	for (const source of sources) {
		if (!source) continue;
		for (const key of keys) {
			const value = source[key];
			if (value === undefined || value === null) continue;
			const text = String(value).trim();
			if (text && text !== "-") return text;
		}
	}
	return "";
}

export type SpanRole =
	| "llm"
	| "tool"
	| "retrieval"
	| "embedding"
	| "database"
	| "http"
	| "orchestrator"
	| "unknown";

export function classifySpanRole(span: TraceHeirarchySpan): SpanRole {
	const attrs = span.SpanAttributes || {};
	const name = (span.SpanName || "").toLowerCase();
	const model = readSpanAttr(span, [
		"gen_ai.request.model",
		"gen_ai.response.model",
	]);

	if (name.includes("embed")) return "embedding";
	if (
		name.includes("retriev") ||
		name.includes("search") ||
		name.includes("vector")
	) {
		return "retrieval";
	}
	if (
		readSpanAttr(span, [
			"gen_ai.tool.name",
			"gen_ai.tool.call.name",
			"tool.name",
			"coding_agent.tool.name",
		]) ||
		name.includes("tool")
	) {
		return "tool";
	}
	if (
		readSpanAttr(span, ["db.query.text", "db.system.name", "db.operation.name"]) ||
		name.includes("db.")
	) {
		return "database";
	}
	if (
		readSpanAttr(span, ["http.method", "http.url", "url.full"]) ||
		name.includes("http")
	) {
		return "http";
	}
	if (model || readSpanAttr(span, ["gen_ai.system"])) return "llm";
	if ((span.children || []).length > 0) return "orchestrator";
	return "unknown";
}

export function maxHierarchyDepth(span: TraceHeirarchySpan, depth = 1): number {
	const children = span.children || [];
	if (!children.length) return depth;
	return Math.max(...children.map((child) => maxHierarchyDepth(child, depth + 1)));
}
