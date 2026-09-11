export const GENERATION_HEALTH_CHIPS = [
	"truncated",
	"filtered",
	"empty",
	"swapped",
] as const;

export type GenerationHealthChip = (typeof GENERATION_HEALTH_CHIPS)[number];

export type FinishCategory =
	| "truncated"
	| "filtered"
	| "empty"
	| "tool_call"
	| "ok"
	| "unknown";

export type GenerationHealth = {
	finishCategory: FinishCategory;
	finishReasonRaw: string;
	modelSwap: boolean;
	requestedModel: string;
	servedModel: string;
	hasFinishReason: boolean;
	hasBothModels: boolean;
	hasOutputTokens: boolean;
	outputTokens: number | null;
};

const TRUNCATED_ALIASES = new Set(["length", "max_tokens", "max_length"]);
const FILTERED_ALIASES = new Set([
	"content_filter",
	"content_filtered",
	"safety",
]);
const TOOL_CALL_ALIASES = new Set(["tool_calls", "tool_use", "tool_call"]);
const OK_ALIASES = new Set(["stop", "end_turn", "stop_sequence"]);

const FINISH_REASON_KEYS = [
	"gen_ai.response.finish_reasons",
	"gen_ai.response.finish_reason",
];
const REQUEST_MODEL_KEYS = ["gen_ai.request.model"];
const RESPONSE_MODEL_KEYS = ["gen_ai.response.model"];
const OUTPUT_TOKEN_KEYS = [
	"gen_ai.usage.output_tokens",
	"gen_ai.client.token.usage.output",
	"gen_ai.usage.completion_tokens",
	"output_tokens",
	"completion_tokens",
];

export function isGenerationHealthChip(
	value: unknown
): value is GenerationHealthChip {
	return (
		typeof value === "string" &&
		(GENERATION_HEALTH_CHIPS as readonly string[]).includes(value)
	);
}

export function parseGenerationHealthChips(
	values: unknown
): GenerationHealthChip[] {
	if (!Array.isArray(values)) return [];
	return values.filter(isGenerationHealthChip);
}

export function hasGenerationHealthFilter(values: unknown): boolean {
	return parseGenerationHealthChips(values).length > 0;
}

function firstAttr(
	attrs: Record<string, unknown> | undefined,
	keys: string[]
): string {
	if (!attrs) return "";
	for (const key of keys) {
		const value = attrs[key];
		if (value === undefined || value === null) continue;
		const text = String(value).trim();
		if (text && text !== "-") return text;
	}
	return "";
}

export function finishReasonTokens(raw: string): string[] {
	if (!raw) return [];
	return raw.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}

export function normalizeModelName(raw: string): string {
	const trimmed = raw.trim().toLowerCase();
	if (!trimmed) return "";
	const slash = trimmed.lastIndexOf("/");
	return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function finishCategoryFromTokens(
	tokens: string[],
	outputTokens: number | null
): FinishCategory {
	if (tokens.some((token) => TOOL_CALL_ALIASES.has(token))) return "tool_call";
	if (tokens.some((token) => TRUNCATED_ALIASES.has(token))) return "truncated";
	if (tokens.some((token) => FILTERED_ALIASES.has(token))) return "filtered";
	if (outputTokens === 0) return "empty";
	if (tokens.some((token) => OK_ALIASES.has(token))) return "ok";
	if (tokens.length === 0) {
		return outputTokens === 0 ? "empty" : "unknown";
	}
	return "ok";
}

function parseOutputTokens(
	attrs: Record<string, unknown> | undefined
): { value: number | null; present: boolean } {
	const raw = firstAttr(attrs, OUTPUT_TOKEN_KEYS);
	if (!raw) return { value: null, present: false };
	const numeric = Number(raw);
	if (!Number.isFinite(numeric)) return { value: null, present: false };
	return { value: numeric, present: true };
}

export function classifyGenerationHealth(
	attrs: Record<string, unknown> | undefined
): GenerationHealth {
	const finishReasonRaw = firstAttr(attrs, FINISH_REASON_KEYS);
	const requestedModel = firstAttr(attrs, REQUEST_MODEL_KEYS);
	const servedModel = firstAttr(attrs, RESPONSE_MODEL_KEYS);
	const tokens = parseOutputTokens(attrs);
	const finishTokens = finishReasonTokens(finishReasonRaw);
	const finishCategory = finishCategoryFromTokens(finishTokens, tokens.value);
	const requestedNorm = normalizeModelName(requestedModel);
	const servedNorm = normalizeModelName(servedModel);
	const hasBothModels = Boolean(requestedNorm && servedNorm);

	return {
		finishCategory,
		finishReasonRaw,
		modelSwap: hasBothModels && requestedNorm !== servedNorm,
		requestedModel,
		servedModel,
		hasFinishReason: finishTokens.length > 0,
		hasBothModels,
		hasOutputTokens: tokens.present,
		outputTokens: tokens.value,
	};
}

export function classifyFromNormalizedTrace(row: {
	finishReason?: unknown;
	model?: unknown;
	responseModel?: unknown;
	completionTokens?: unknown;
	SpanAttributes?: Record<string, unknown>;
}): GenerationHealth {
	const attrs = { ...(row.SpanAttributes || {}) };
	if (row.finishReason != null && String(row.finishReason).trim() !== "-") {
		attrs["gen_ai.response.finish_reasons"] = row.finishReason;
	}
	if (row.model != null && String(row.model).trim() !== "-") {
		attrs["gen_ai.request.model"] = row.model;
	}
	if (row.responseModel != null && String(row.responseModel).trim() !== "-") {
		attrs["gen_ai.response.model"] = row.responseModel;
	}
	if (
		row.completionTokens != null &&
		String(row.completionTokens).trim() !== "-"
	) {
		attrs["gen_ai.usage.output_tokens"] = row.completionTokens;
	}
	return classifyGenerationHealth(attrs);
}

export function matchesGenerationHealthChip(
	health: GenerationHealth,
	chip: GenerationHealthChip
): boolean {
	if (chip === "truncated") {
		return health.hasFinishReason && health.finishCategory === "truncated";
	}
	if (chip === "filtered") {
		return health.hasFinishReason && health.finishCategory === "filtered";
	}
	if (chip === "empty") {
		return (
			health.hasOutputTokens &&
			health.outputTokens === 0 &&
			health.finishCategory !== "tool_call"
		);
	}
	return health.modelSwap;
}

export function spanMatchesAnyGenerationHealthChip(
	attrs: Record<string, unknown> | undefined,
	chips: GenerationHealthChip[] | undefined
): boolean {
	if (!chips?.length) return true;
	const health = classifyGenerationHealth(attrs);
	return chips.some((chip) => matchesGenerationHealthChip(health, chip));
}

export function spanGenerationHealthAttrs(span: {
	spanAttributes?: Record<string, unknown>;
	resourceAttributes?: Record<string, unknown>;
}): Record<string, unknown> {
	return {
		...(span.resourceAttributes || {}),
		...(span.spanAttributes || {}),
	};
}

export function firstSpanMatchingGenerationHealth<
	T extends {
		spanAttributes?: Record<string, unknown>;
		resourceAttributes?: Record<string, unknown>;
	},
>(spans: T[], chips: GenerationHealthChip[] | undefined): T | undefined {
	if (!chips?.length) return undefined;
	return spans.find((span) =>
		spanMatchesAnyGenerationHealthChip(spanGenerationHealthAttrs(span), chips)
	);
}

/** One listed row per matching trace (the span that actually has the issue). */
export function listedSpansMatchingGenerationHealth<
	T extends {
		traceId?: string;
		spanAttributes?: Record<string, unknown>;
		resourceAttributes?: Record<string, unknown>;
	},
>(spans: T[], chips: GenerationHealthChip[] | undefined): T[] {
	if (!chips?.length) return spans;
	const grouped = new Map<string, T[]>();
	spans.forEach((span, index) => {
		const key = String(span.traceId || "").trim() || `span:${index}`;
		const group = grouped.get(key);
		if (group) group.push(span);
		else grouped.set(key, [span]);
	});
	const listed: T[] = [];
	for (const group of Array.from(grouped.values())) {
		const hit = firstSpanMatchingGenerationHealth(group, chips);
		if (hit) listed.push(hit);
	}
	return listed;
}

/** Same budget as Jaeger/Tempo list sampling so chip filters can fill a page. */
export const GENERATION_HEALTH_SAMPLE_TRACES = 200;
/** Hard ceiling when expanding the sample to fill a later filtered page. */
export const GENERATION_HEALTH_SAMPLE_MAX = 1000;

export function uniqueTraceCount(spans: Array<{ traceId?: string }>): number {
	const ids = new Set<string>();
	for (const span of spans) {
		const id = String(span.traceId || "").trim();
		if (id) ids.add(id);
	}
	return ids.size || spans.length;
}

export function percentOfEligible(count: number, eligible: number): number {
	if (!Number.isFinite(eligible) || eligible <= 0) return 0;
	if (!Number.isFinite(count) || count <= 0) return 0;
	return (count / eligible) * 100;
}
