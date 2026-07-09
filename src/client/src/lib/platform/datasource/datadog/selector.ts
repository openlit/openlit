/**
 * Translate the vendor-agnostic AI selector into a Datadog spans search query.
 *
 * Datadog query syntax:
 *   - span attributes are queried with a leading `@`  (e.g. `@gen_ai.operation.name:*`)
 *   - resource attributes arrive as tags, queried without `@` (e.g. `telemetry.sdk.name:openlit`)
 *   - the OTel span name maps to `operation_name`
 *   - `*` matches "attribute present"; groups are ORed with `OR` inside parens
 */

import {
	buildAITelemetrySelector,
	type AITelemetrySelector,
	type SelectorCondition,
} from "../ai-selector";

/** Escape a Datadog query value (quote when it contains special chars). */
function ddValue(value: string): string {
	if (/^[a-zA-Z0-9_.\-/]+$/.test(value)) return value;
	return `"${value.replace(/"/g, '\\"')}"`;
}

function conditionToDatadog(cond: SelectorCondition): string {
	if (cond.target === "spanName") {
		const values = Array.isArray(cond.value) ? cond.value : [cond.value || ""];
		return `operation_name:(${values.map((v) => ddValue(String(v))).join(" OR ")})`;
	}
	const prefix = cond.scope === "span" ? "@" : "";
	const key = `${prefix}${cond.key}`;
	if (cond.op === "exists") return `${key}:*`;
	if (cond.op === "eq") return `${key}:${ddValue(String(cond.value ?? ""))}`;
	if (cond.op === "in") {
		const values = Array.isArray(cond.value) ? cond.value : [cond.value || ""];
		return `${key}:(${values.map((v) => ddValue(String(v))).join(" OR ")})`;
	}
	return "";
}

/** Build the OR-of-AND-groups Datadog query for the AI selector. */
export function datadogAISelectorQuery(
	selector: AITelemetrySelector = buildAITelemetrySelector()
): string {
	const groups = selector.anyOf.map((predicate) => {
		const parts = predicate.allOf.map(conditionToDatadog).filter(Boolean);
		return parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`;
	});
	return `(${groups.join(" OR ")})`;
}
