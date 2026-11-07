/**
 * In-process evaluation of the AI telemetry selector against a NormalizedSpan.
 *
 * Some backends (Jaeger, and any tag-only search) cannot express the full
 * OR-of-AND selector server-side. Those adapters fetch a bounded set of traces
 * and filter locally with this matcher, which mirrors the ClickHouse/TraceQL/
 * NRQL translations exactly so results stay consistent across sources.
 */

import {
	buildAITelemetrySelector,
	type AITelemetrySelector,
	type SelectorCondition,
} from "./ai-selector";
import { spanFieldValue } from "./graph/sample-aggregate";
import type { NormalizedFilter, NormalizedSpan } from "./types";

function attrValue(span: NormalizedSpan, cond: SelectorCondition): string | undefined {
	const key = cond.key || "";
	if (cond.scope === "resource") return span.resourceAttributes[key];
	if (cond.scope === "span") return span.spanAttributes[key];
	// Unscoped: check span attributes first, then resource attributes.
	return span.spanAttributes[key] ?? span.resourceAttributes[key];
}

function matchesCondition(span: NormalizedSpan, cond: SelectorCondition): boolean {
	if (cond.target === "spanName") {
		const values = Array.isArray(cond.value) ? cond.value : [cond.value || ""];
		return values.map(String).includes(span.name);
	}
	const value = attrValue(span, cond);
	switch (cond.op) {
		case "exists":
			return value !== undefined && value !== "";
		case "eq":
			return value === String(cond.value ?? "");
		case "in": {
			const values = Array.isArray(cond.value) ? cond.value : [cond.value || ""];
			return value !== undefined && values.map(String).includes(value);
		}
		default:
			return false;
	}
}

/** True when a span matches any predicate of the AI selector. */
export function spanMatchesAISelector(
	span: NormalizedSpan,
	selector: AITelemetrySelector = buildAITelemetrySelector()
): boolean {
	return selector.anyOf.some((predicate) =>
		predicate.allOf.every((cond) => matchesCondition(span, cond))
	);
}

/**
 * True when *any* span in a trace matches the AI selector. Used by trace-level
 * backends: if a trace has one AI-relevant span, the whole trace is kept so the
 * chat view / graph has full context.
 */
export function traceMatchesAISelector(
	spans: NormalizedSpan[],
	selector: AITelemetrySelector = buildAITelemetrySelector()
): boolean {
	return spans.some((s) => spanMatchesAISelector(s, selector));
}

/** True when a span satisfies every normalized UI filter (AND semantics). */
export function spanMatchesFilters(
	span: NormalizedSpan,
	filters?: NormalizedFilter[]
): boolean {
	if (!filters?.length) return true;
	return filters.every((filter) => {
		if (filter.target === "spanName") {
			const values = Array.isArray(filter.value)
				? filter.value.map(String)
				: [String(filter.value || "")];
			return values.includes(span.name);
		}
		if (filter.target === "status") {
			const values = Array.isArray(filter.value)
				? filter.value.map(String)
				: [String(filter.value || "")];
			const wantsError = values.some(
				(v) => /error/i.test(v) || v === "STATUS_CODE_ERROR"
			);
			const isError = /error/i.test(span.statusCode || "");
			return wantsError ? isError : !isError;
		}
		if (
			(filter.target === "attribute" || filter.target === "field") &&
			filter.key
		) {
			const raw = spanFieldValue(span, filter.key);
			const value = raw === undefined ? undefined : String(raw);
			if (filter.op === "exists") return !!value;
			if (filter.op === "eq") return value === String(filter.value ?? "");
			if (filter.op === "neq") return value !== String(filter.value ?? "");
			if (filter.op === "contains") {
				return !!value && value.toLowerCase().includes(String(filter.value ?? "").toLowerCase());
			}
			if (filter.op === "in") {
				const values = Array.isArray(filter.value)
					? filter.value.map(String)
					: [String(filter.value || "")];
				return value !== undefined && values.includes(value);
			}
		}
		return true;
	});
}
