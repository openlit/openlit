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
import type { NormalizedSpan } from "./types";

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
