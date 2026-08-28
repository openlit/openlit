import type { GenerationHealthChip } from "./classify";

const FINISH_REASONS_KEY = "gen_ai.response.finish_reasons";
const FINISH_REASON_KEY = "gen_ai.response.finish_reason";
const REQUEST_MODEL_KEY = "gen_ai.request.model";
const RESPONSE_MODEL_KEY = "gen_ai.response.model";
const OUTPUT_TOKEN_KEYS = [
	"gen_ai.usage.output_tokens",
	"gen_ai.client.token.usage.output",
	"gen_ai.usage.completion_tokens",
];

export const FINISH_REASON_RAW_SQL = `if(notEmpty(SpanAttributes['${FINISH_REASONS_KEY}']), SpanAttributes['${FINISH_REASONS_KEY}'], SpanAttributes['${FINISH_REASON_KEY}'])`;

export const FINISH_REASON_NORM_SQL = `replaceRegexpAll(lowerUTF8(${FINISH_REASON_RAW_SQL}), '[^a-z0-9_,]', '')`;

export const HAS_FINISH_REASON_SQL = `notEmpty(${FINISH_REASON_RAW_SQL})`;

function matchAliases(aliases: string[]): string {
	return `match(${FINISH_REASON_NORM_SQL}, '(^|,)(${aliases.join("|")})(,|$)')`;
}

export const IS_TRUNCATED_SQL = matchAliases([
	"length",
	"max_tokens",
	"max_length",
]);
export const IS_FILTERED_SQL = matchAliases([
	"content_filter",
	"content_filtered",
	"safety",
]);
export const IS_TOOL_CALL_SQL = matchAliases([
	"tool_calls",
	"tool_use",
	"tool_call",
]);

export const HAS_OUTPUT_TOKENS_SQL = `(${OUTPUT_TOKEN_KEYS.map(
	(key) => `notEmpty(SpanAttributes['${key}'])`
).join(" OR ")})`;

export const OUTPUT_TOKENS_SQL = `toFloat64OrZero(if(notEmpty(SpanAttributes['${OUTPUT_TOKEN_KEYS[0]}']), SpanAttributes['${OUTPUT_TOKEN_KEYS[0]}'], if(notEmpty(SpanAttributes['${OUTPUT_TOKEN_KEYS[1]}']), SpanAttributes['${OUTPUT_TOKEN_KEYS[1]}'], SpanAttributes['${OUTPUT_TOKEN_KEYS[2]}'])))`;

export const IS_EMPTY_SQL = `(${HAS_OUTPUT_TOKENS_SQL} AND ${OUTPUT_TOKENS_SQL} = 0 AND NOT (${IS_TOOL_CALL_SQL}))`;

function modelRawSql(key: string): string {
	return `trim(BOTH ' ' FROM SpanAttributes['${key}'])`;
}

/** Last path segment after `/`, else the whole name. `openai/gpt-4o` → `gpt-4o`. */
function normalizeModelSql(key: string): string {
	const raw = modelRawSql(key);
	return `lowerUTF8(replaceRegexpOne(${raw}, '^[^/]+/', ''))`;
}

export const HAS_BOTH_MODELS_SQL = `(notEmpty(${modelRawSql(REQUEST_MODEL_KEY)}) AND notEmpty(${modelRawSql(RESPONSE_MODEL_KEY)}))`;

export const IS_MODEL_SWAP_SQL = `(${HAS_BOTH_MODELS_SQL} AND ${normalizeModelSql(REQUEST_MODEL_KEY)} != ${normalizeModelSql(RESPONSE_MODEL_KEY)})`;

export const HAS_LLM_SPAN_SQL = `(notEmpty(SpanAttributes['${REQUEST_MODEL_KEY}']) OR notEmpty(SpanAttributes['gen_ai.operation.name']) OR ${HAS_FINISH_REASON_SQL} OR notEmpty(${modelRawSql(RESPONSE_MODEL_KEY)}))`;

const CHIP_PREDICATE: Record<GenerationHealthChip, string> = {
	truncated: `(${HAS_FINISH_REASON_SQL} AND ${IS_TRUNCATED_SQL})`,
	filtered: `(${HAS_FINISH_REASON_SQL} AND ${IS_FILTERED_SQL})`,
	empty: IS_EMPTY_SQL,
	swapped: IS_MODEL_SWAP_SQL,
};

export function generationHealthWhereSql(
	chips: GenerationHealthChip[] | undefined
): string {
	const unique = Array.from(new Set(chips || []));
	if (!unique.length) return "";
	return `(${unique.map((chip) => CHIP_PREDICATE[chip]).join(" OR ")})`;
}
