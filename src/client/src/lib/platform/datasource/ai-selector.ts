/**
 * Unified AI telemetry selector (CE).
 *
 * A customer's external observability backend (Datadog, Tempo, ...) holds all
 * of their telemetry — HTTP, DB, infra — not just AI. This module defines the
 * single, layered predicate that identifies "AI-relevant" telemetry, seeded
 * from the selectors already used across the app (materialize.ts, snapshot.ts,
 * getFilterWhereCondition, CODING_AGENT_SPAN_NAMES, SUPPORTED_EVALUATION_OPERATIONS).
 *
 * The selector is expressed as a vendor-agnostic predicate tree so every
 * adapter can translate it to its native filter language and always push it
 * down to the vendor. The ClickHouse translation lives here as the reference.
 *
 * OpenLIT's own SDKs/CLI/controller self-stamp AI telemetry, which is what
 * makes this filter reliable:
 *   - OpenLIT SDK (Python/TS/Go) + controller OBI: resource `telemetry.sdk.name = "openlit"`.
 *   - Coding CLI: resource `telemetry.distro.name = "openlit-cli"` + `coding_agent.*`.
 *   - Generic GenAI: `gen_ai.*` semconv (operation, model, system/provider, tool).
 *   - Native Claude Code: `service.name = "claude-code"` + `session.id`.
 */

import { CODING_AGENT_SPAN_NAMES } from "@/lib/platform/coding-agents/table-details";
import { SUPPORTED_EVALUATION_OPERATIONS } from "@/constants/traces";
import type { AttributeScope } from "./types";

/** Marker attribute keys used by the AI selector. */
export const AI_SELECTOR_MARKERS = {
	telemetrySdkName: "telemetry.sdk.name",
	telemetryDistroName: "telemetry.distro.name",
	openlitSdkValue: "openlit",
	openlitCliValue: "openlit-cli",
	genAiOperation: "gen_ai.operation.name",
	genAiModel: "gen_ai.request.model",
	genAiSystem: "gen_ai.system",
	genAiProvider: "gen_ai.provider.name",
	genAiTool: "gen_ai.tool.name",
	genAiSystemInstructions: "gen_ai.system_instructions",
	codingSessionId: "coding_agent.session.id",
	serviceName: "service.name",
	claudeCodeValue: "claude-code",
	sessionId: "session.id",
	vectorDbOperationValue: "vectordb",
} as const;

/** A single condition in the selector predicate. */
export interface SelectorCondition {
	target: "attribute" | "spanName";
	scope?: AttributeScope;
	key?: string;
	op: "exists" | "eq" | "in";
	value?: string | string[];
}

/** A predicate: all conditions ANDed together. */
export interface SelectorPredicate {
	allOf: SelectorCondition[];
}

/** The full selector: any predicate matching (OR) qualifies a row as AI data. */
export interface AITelemetrySelector {
	anyOf: SelectorPredicate[];
}

const single = (cond: SelectorCondition): SelectorPredicate => ({
	allOf: [cond],
});

/**
 * Build the unified AI telemetry selector. Order is not significant (OR), but
 * cheapest/most-selective identity markers are listed first for readability.
 */
export function buildAITelemetrySelector(): AITelemetrySelector {
	return {
		anyOf: [
			// Tier A — OpenLIT SDK + controller OBI identity.
			single({
				target: "attribute",
				scope: "resource",
				key: AI_SELECTOR_MARKERS.telemetrySdkName,
				op: "eq",
				value: AI_SELECTOR_MARKERS.openlitSdkValue,
			}),
			// Tier C — coding-agent CLI distro identity.
			single({
				target: "attribute",
				scope: "resource",
				key: AI_SELECTOR_MARKERS.telemetryDistroName,
				op: "eq",
				value: AI_SELECTOR_MARKERS.openlitCliValue,
			}),
			// Tier B — generic GenAI semconv (LLM / vectordb / agent frameworks).
			single({
				target: "attribute",
				scope: "span",
				key: AI_SELECTOR_MARKERS.genAiOperation,
				op: "exists",
			}),
			single({
				target: "attribute",
				scope: "span",
				key: AI_SELECTOR_MARKERS.genAiModel,
				op: "exists",
			}),
			single({
				target: "attribute",
				scope: "span",
				key: AI_SELECTOR_MARKERS.genAiSystem,
				op: "exists",
			}),
			single({
				target: "attribute",
				scope: "span",
				key: AI_SELECTOR_MARKERS.genAiProvider,
				op: "exists",
			}),
			single({
				target: "attribute",
				scope: "span",
				key: AI_SELECTOR_MARKERS.genAiTool,
				op: "exists",
			}),
			// Tier C — coding agents (span + resource variants).
			single({
				target: "attribute",
				scope: "span",
				key: AI_SELECTOR_MARKERS.codingSessionId,
				op: "exists",
			}),
			single({
				target: "attribute",
				scope: "resource",
				key: AI_SELECTOR_MARKERS.codingSessionId,
				op: "exists",
			}),
			// Native Claude Code — service.name=claude-code AND session.id present.
			{
				allOf: [
					{
						target: "attribute",
						scope: "resource",
						key: AI_SELECTOR_MARKERS.serviceName,
						op: "eq",
						value: AI_SELECTOR_MARKERS.claudeCodeValue,
					},
					{
						target: "attribute",
						scope: "span",
						key: AI_SELECTOR_MARKERS.sessionId,
						op: "exists",
					},
				],
			},
			// Coding-agent span names.
			single({
				target: "spanName",
				op: "in",
				value: [...CODING_AGENT_SPAN_NAMES],
			}),
		],
	};
}

/** ClickHouse string escaping for selector values. */
function escapeCH(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function chScopeColumn(scope: AttributeScope | undefined): string {
	switch (scope) {
		case "resource":
			return "ResourceAttributes";
		case "log":
			return "LogAttributes";
		case "metric":
			return "Attributes";
		case "span":
		default:
			return "SpanAttributes";
	}
}

/** Translate a single condition to a ClickHouse boolean expression. */
function conditionToClickHouse(cond: SelectorCondition): string {
	if (cond.target === "spanName") {
		if (cond.op === "in" && Array.isArray(cond.value)) {
			const list = cond.value.map((v) => `'${escapeCH(v)}'`).join(", ");
			return `SpanName IN (${list})`;
		}
		if (cond.op === "eq" && typeof cond.value === "string") {
			return `SpanName = '${escapeCH(cond.value)}'`;
		}
		throw new Error(`Unsupported spanName op: ${cond.op}`);
	}

	const col = `${chScopeColumn(cond.scope)}['${escapeCH(cond.key || "")}']`;
	switch (cond.op) {
		case "exists":
			return `notEmpty(${col})`;
		case "eq":
			return `${col} = '${escapeCH(String(cond.value ?? ""))}'`;
		case "in": {
			const values = Array.isArray(cond.value) ? cond.value : [cond.value];
			const list = values
				.map((v) => `'${escapeCH(String(v ?? ""))}'`)
				.join(", ");
			return `${col} IN (${list})`;
		}
		default:
			throw new Error(`Unsupported attribute op: ${cond.op}`);
	}
}

/**
 * Translate the AI selector into a ClickHouse WHERE fragment (no leading
 * WHERE). Returns a parenthesized OR of AND-groups.
 */
export function aiSelectorToClickHouse(
	selector: AITelemetrySelector = buildAITelemetrySelector()
): string {
	const groups = selector.anyOf.map((predicate) => {
		const parts = predicate.allOf.map(conditionToClickHouse);
		return parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`;
	});
	return `(${groups.join(" OR ")})`;
}

/**
 * Sub-selector: operation-type split used by dashboards/telemetry.
 * `vectordb` isolates vector DB spans; `llm` excludes them.
 */
export function operationTypeClauseToClickHouse(
	operationType: "llm" | "vectordb"
): string {
	const col = `SpanAttributes['${AI_SELECTOR_MARKERS.genAiOperation}']`;
	return operationType === "vectordb"
		? `${col} = '${AI_SELECTOR_MARKERS.vectorDbOperationValue}'`
		: `${col} != '${AI_SELECTOR_MARKERS.vectorDbOperationValue}'`;
}

/**
 * Sub-selector: the eval-candidate subset. Matches spans whose operation is in
 * the supported evaluation operations (currently `chat`).
 */
export function evalOperationClauseToClickHouse(): string {
	const col = `SpanAttributes['${AI_SELECTOR_MARKERS.genAiOperation}']`;
	const list = SUPPORTED_EVALUATION_OPERATIONS.map(
		(op) => `'${escapeCH(op)}'`
	).join(", ");
	return `${col} IN (${list})`;
}
