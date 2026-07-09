/**
 * Translate the vendor-agnostic AI selector into an NRQL WHERE fragment.
 *
 * New Relic stores spans as the `Span` event type; OTel span *and* resource
 * attributes both land as flat attributes on the event, so the scope is
 * irrelevant to the column name (unlike ClickHouse/Datadog). Dotted keys are
 * backtick-quoted. The OTel span name maps to the `name` attribute. Groups are
 * ORed, conditions within a group ANDed, matching `buildAITelemetrySelector`.
 */

import {
	buildAITelemetrySelector,
	type AITelemetrySelector,
	type SelectorCondition,
} from "../ai-selector";

/** NRQL string literal escaping (single-quoted). */
function nrqlStr(value: string): string {
	return `'${value.replace(/'/g, "\\'")}'`;
}

/** Backtick-quote an attribute key when it contains dots or special chars. */
function nrqlKey(key: string): string {
	return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) ? key : `\`${key}\``;
}

function conditionToNRQL(cond: SelectorCondition): string {
	if (cond.target === "spanName") {
		const values = Array.isArray(cond.value) ? cond.value : [cond.value || ""];
		return `name IN (${values.map((v) => nrqlStr(String(v))).join(", ")})`;
	}
	const key = nrqlKey(cond.key || "");
	if (cond.op === "exists") return `${key} IS NOT NULL`;
	if (cond.op === "eq") return `${key} = ${nrqlStr(String(cond.value ?? ""))}`;
	if (cond.op === "in") {
		const values = Array.isArray(cond.value) ? cond.value : [cond.value || ""];
		return `${key} IN (${values.map((v) => nrqlStr(String(v))).join(", ")})`;
	}
	return "";
}

/**
 * Build the NRQL WHERE fragment (no leading WHERE) for the AI selector as an
 * OR of AND-groups, wrapped in a single parenthesized expression.
 */
export function newrelicAISelectorWhere(
	selector: AITelemetrySelector = buildAITelemetrySelector()
): string {
	const groups = selector.anyOf.map((predicate) => {
		const parts = predicate.allOf.map(conditionToNRQL).filter(Boolean);
		return parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`;
	});
	return `(${groups.join(" OR ")})`;
}
