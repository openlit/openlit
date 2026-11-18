/**
 * SigNoz v5 filter-expression compiler.
 *
 * Grammar (docs + query-service parser): `field OP value [AND|OR ...]` with
 * OP in = != > >= < <= IN "NOT IN" EXISTS "NOT EXISTS" CONTAINS REGEXP.
 * String literals are single-quoted. A negative comparison (!=, NOT IN) does
 * NOT imply the field exists, so the compiler emits
 * `field EXISTS AND field != 'v'` where an absent field should not match -
 * otherwise spans without the attribute would pass a "not equal" filter.
 *
 * Field names are interpolated into the expression raw, so every name -
 * filter keys, groupBy columns, aggregation fields - must pass
 * FIELD_NAME_RE. Hostile or malformed names are dropped (the condition
 * degrades to "no filter"), never quoted into validity.
 */

import {
	buildAITelemetrySelector,
	type AITelemetrySelector,
	type SelectorCondition,
} from "../ai-selector";
import type { NormalizedFilter, OpenLITQuery, Signal } from "../types";

/** SigNoz field names are dot/colon paths; anything else is rejected. */
const FIELD_NAME_RE = /^[A-Za-z_][\w.\-:@/]*$/;

export function safeFieldName(name: string | null | undefined): string | null {
	if (!name || !FIELD_NAME_RE.test(name)) return null;
	return name;
}

export function escapeLiteral(value: string): string {
	return `'${value
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'")
		.replace(/[\r\n\0]/g, " ")}'`;
}

function filterValues(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : [value];
	return raw
		.filter((item) => item !== undefined && item !== null && String(item) !== "")
		.map(String);
}

/** Maps normalized filter targets/scopes onto SigNoz v5 field names. */
function signozFieldName(filter: NormalizedFilter, signal: Signal): string | null {
	if (filter.target === "spanName") return "name";
	if (filter.target === "status") return "has_error";
	if (filter.target === "duration") return "duration_nano";
	if (filter.target === "field" && filter.key) {
		const lowered = filter.key.toLowerCase();
		if (signal === "traces") {
			if (lowered === "traceid" || lowered === "trace_id") return "trace_id";
			if (lowered === "spanid" || lowered === "span_id") return "span_id";
			if (lowered === "parentspanid" || lowered === "parent_span_id")
				return "parent_span_id";
		}
		if (signal === "logs") {
			if (lowered === "traceid" || lowered === "trace_id") return "trace_id";
			if (lowered === "spanid" || lowered === "span_id") return "span_id";
			if (lowered === "id") return "id";
		}
		return safeFieldName(filter.key);
	}
	if (filter.target === "attribute") return safeFieldName(filter.key);
	return null;
}

function compileFilter(filter: NormalizedFilter, signal: Signal): string | null {
	const field = signozFieldName(filter, signal);
	if (!field) return null;
	const values = filterValues(filter.value);

	if (filter.target === "status") {
		// SigNoz stores status as a boolean; only equality/inequality map onto
		// it. Everything else (exists, in/notIn, contains) is unsupported.
		const wantsError = values.some(
			(v) => /error/i.test(v) || v === "STATUS_CODE_ERROR"
		);
		if (filter.op === "eq") {
			return `has_error = ${wantsError ? "true" : "false"}`;
		}
		if (filter.op === "neq") {
			return `has_error = ${wantsError ? "false" : "true"}`;
		}
		return null;
	}

	switch (filter.op) {
		case "exists":
			return `${field} EXISTS`;
		case "notExists":
			return `${field} NOT EXISTS`;
		case "eq":
			if (values.length === 0) return null;
			return `${field} = ${escapeLiteral(values[0])}`;
		case "neq":
			if (values.length === 0) return null;
			return `${field} EXISTS AND ${field} != ${escapeLiteral(values[0])}`;
		case "in":
			if (values.length === 0) return null;
			return `${field} IN (${values.map(escapeLiteral).join(", ")})`;
		case "notIn":
			if (values.length === 0) return null;
			return `${field} EXISTS AND ${field} NOT IN (${values
				.map(escapeLiteral)
				.join(", ")})`;
		case "contains":
			if (values.length === 0) return null;
			return `${field} CONTAINS ${escapeLiteral(values[0])}`;
		case "gt":
		case "gte":
		case "lt":
		case "lte": {
			const raw = filter.value;
			const num =
				typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
			if (!Number.isFinite(num)) return null;
			const op = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[filter.op];
			return `${field} ${op} ${num}`;
		}
		default:
			return null;
	}
}

export function buildSignozFilterExpression(
	query: OpenLITQuery,
	extra: string[] = []
): string | undefined {
	const parts: string[] = [...extra];
	for (const filter of query.filters || []) {
		const compiled = compileFilter(filter, query.signal);
		if (compiled) parts.push(compiled);
	}
	if (parts.length === 0) return undefined;
	return parts.join(" AND ");
}

/** Translate one AI-selector condition into the v5 grammar. */
function compileSelectorCondition(cond: SelectorCondition): string | null {
	if (cond.target === "spanName") {
		const values = (Array.isArray(cond.value) ? cond.value : [cond.value || ""])
			.map(String)
			.filter(Boolean);
		if (values.length === 0) return null;
		if (cond.op === "eq") return `name = ${escapeLiteral(values[0])}`;
		if (cond.op === "in") {
			return `name IN (${values.map(escapeLiteral).join(", ")})`;
		}
		return null;
	}
	const key = safeFieldName(cond.key);
	if (!key) return null;
	// Resource attributes are addressed with the resource. prefix in the v5
	// expression grammar (matching fieldContext: "resource" on field specs).
	const field = cond.scope === "resource" ? `resource.${key}` : key;
	if (cond.op === "exists") return `${field} EXISTS`;
	if (cond.op === "eq") {
		return `${field} = ${escapeLiteral(String(cond.value ?? ""))}`;
	}
	if (cond.op === "in") {
		const values = (Array.isArray(cond.value) ? cond.value : [cond.value])
			.map(String)
			.filter((v) => v !== "");
		if (values.length === 0) return null;
		return `${field} IN (${values.map(escapeLiteral).join(", ")})`;
	}
	return null;
}

/**
 * Push the unified AI telemetry selector down to SigNoz as one parenthesized
 * OR-of-ANDs expression. Applied WITHOUT the root-span restriction so a trace
 * whose gen_ai.* attributes live on child spans still qualifies; the caller
 * then resolves matching trace ids back to their roots (Jaeger trace-level
 * semantics). Predicates that cannot be translated drop out; if nothing
 * translates, returns undefined so the caller can fall back to local matching.
 */
export function buildAISelectorExpression(
	selector: AITelemetrySelector = buildAITelemetrySelector()
): string | undefined {
	const predicates: string[] = [];
	for (const predicate of selector.anyOf) {
		const conditions: string[] = [];
		let translatable = true;
		for (const cond of predicate.allOf) {
			const compiled = compileSelectorCondition(cond);
			if (!compiled) {
				translatable = false;
				break;
			}
			conditions.push(compiled);
		}
		if (translatable && conditions.length > 0) {
			predicates.push(
				conditions.length === 1 ? conditions[0] : `(${conditions.join(" AND ")})`
			);
		}
	}
	if (predicates.length === 0) return undefined;
	// Outer parens: callers AND this selector with other clauses; without the
	// wrap, "A OR B AND user" would bind the user clause to the last OR group.
	return `(${predicates
		.map((p) => (p.startsWith("(") ? p : `(${p})`))
		.join(" OR ")})`;
}
