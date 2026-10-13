import type { RealtimeRuleCondition } from "./types";
import type { LiveSignal } from "./signals";

// TypeScript port of the engine's span matching (src/engine/internal/rules
// Condition.matches and signal.Field/Number). Used to show which recent spans
// an alert evaluates; the engine stays the source of truth for findings.

function stringField(signal: LiveSignal, field: string, environment: string): string | undefined {
	switch (field) {
		case "service":
			return signal.service;
		case "model":
			return signal.model;
		case "provider":
			return signal.provider;
		case "operation":
			return signal.operation;
		case "status":
			return signal.status;
		case "error_type":
			return "";
		case "environment":
			return environment;
		case "span_name":
			return signal.spanName;
	}
	if (Object.prototype.hasOwnProperty.call(signal.attributes || {}, field)) {
		return signal.attributes[field];
	}
	return undefined;
}

function numberField(signal: LiveSignal, field: string): number | undefined {
	switch (field) {
		case "http_status":
			return signal.httpStatus;
		case "duration_ms":
			return signal.durationMs;
		case "input_tokens":
			return signal.inputTokens;
		case "output_tokens":
			return signal.outputTokens;
		case "total_tokens":
			return signal.totalTokens;
		case "cost":
			return signal.cost === null ? undefined : signal.cost;
	}
	const raw = signal.attributes?.[field];
	if (raw === undefined || raw.trim() === "") return undefined;
	const value = Number(raw.trim());
	return Number.isFinite(value) ? value : undefined;
}

function compare(op: string, value: number, threshold: number): boolean {
	switch (op) {
		case "gt":
			return value > threshold;
		case "gte":
			return value >= threshold;
		case "lt":
			return value < threshold;
		case "lte":
			return value <= threshold;
	}
	return false;
}

function conditionMatches(signal: LiveSignal, condition: RealtimeRuleCondition, environment: string): boolean {
	const values = condition.values || [];
	if (["gt", "gte", "lt", "lte"].includes(condition.op)) {
		const value = numberField(signal, condition.field);
		const threshold = Number(values[0]);
		if (value === undefined || values.length === 0 || !Number.isFinite(threshold)) return false;
		return compare(condition.op, value, threshold);
	}
	let value = stringField(signal, condition.field, environment);
	if (value === undefined) {
		const number = numberField(signal, condition.field);
		if (number === undefined) return false;
		value = String(number);
	}
	const lower = value.toLowerCase();
	const has = (candidate: string) => candidate.toLowerCase() === lower;
	switch (condition.op) {
		case "exists":
			return value !== "" && value !== "0";
		case "eq":
			return values.length > 0 && has(values[0]);
		case "neq":
			return values.length > 0 && !has(values[0]);
		case "in":
			return values.some(has);
		case "not_in":
			return value !== "" && !values.some(has);
		case "contains":
			return values.length > 0 && lower.includes(values[0].toLowerCase());
	}
	return false;
}

/** True when every condition matches, as the engine evaluates `match`. */
export function signalMatchesConditions(
	signal: LiveSignal,
	conditions: RealtimeRuleCondition[],
	environment: string
): boolean {
	return conditions.every((condition) => conditionMatches(signal, condition, environment));
}
