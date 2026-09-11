import {
	classifyFromNormalizedTrace,
	classifyGenerationHealth,
	finishReasonTokens,
	firstSpanMatchingGenerationHealth,
	isGenerationHealthChip,
	matchesGenerationHealthChip,
	normalizeModelName,
	parseGenerationHealthChips,
	percentOfEligible,
	listedSpansMatchingGenerationHealth,
	spanGenerationHealthAttrs,
	spanMatchesAnyGenerationHealthChip,
	hasGenerationHealthFilter,
	uniqueTraceCount,
} from "@/lib/platform/generation-health/classify";
import { generationHealthWhereSql } from "@/lib/platform/generation-health/sql";

describe("classifyGenerationHealth", () => {
	it("maps OpenAI length to truncated", () => {
		const health = classifyGenerationHealth({
			"gen_ai.response.finish_reasons": "length",
			"gen_ai.usage.output_tokens": "12",
		});
		expect(health.finishCategory).toBe("truncated");
		expect(health.hasFinishReason).toBe(true);
		expect(matchesGenerationHealthChip(health, "truncated")).toBe(true);
	});

	it("maps array-encoded and Anthropic/Google aliases", () => {
		expect(
			classifyGenerationHealth({
				"gen_ai.response.finish_reasons": "['max_tokens']",
			}).finishCategory
		).toBe("truncated");
		expect(
			classifyGenerationHealth({
				"gen_ai.response.finish_reason": "MAX_TOKENS",
			}).finishCategory
		).toBe("truncated");
		expect(
			classifyGenerationHealth({
				"gen_ai.response.finish_reasons": '["content_filter"]',
			}).finishCategory
		).toBe("filtered");
		expect(
			classifyGenerationHealth({
				"gen_ai.response.finish_reason": "SAFETY",
			}).finishCategory
		).toBe("filtered");
	});

	it("does not treat tool_call as empty even with 0 output tokens", () => {
		const health = classifyGenerationHealth({
			"gen_ai.response.finish_reasons": "tool_calls",
			"gen_ai.usage.output_tokens": "0",
		});
		expect(health.finishCategory).toBe("tool_call");
		expect(matchesGenerationHealthChip(health, "empty")).toBe(false);
	});

	it("treats zero output tokens as empty when the field is present", () => {
		const health = classifyGenerationHealth({
			"gen_ai.response.finish_reasons": "stop",
			"gen_ai.usage.output_tokens": "0",
		});
		expect(health.finishCategory).toBe("empty");
		expect(health.hasOutputTokens).toBe(true);
		expect(matchesGenerationHealthChip(health, "empty")).toBe(true);
	});

	it("skips empty when output tokens are missing", () => {
		const health = classifyGenerationHealth({
			"gen_ai.response.finish_reasons": "stop",
		});
		expect(health.finishCategory).toBe("ok");
		expect(health.hasOutputTokens).toBe(false);
		expect(matchesGenerationHealthChip(health, "empty")).toBe(false);
	});

	it("flags a model swap and ignores gateway prefixes", () => {
		const health = classifyGenerationHealth({
			"gen_ai.request.model": "openai/gpt-4o",
			"gen_ai.response.model": "gpt-4o-mini",
		});
		expect(health.modelSwap).toBe(true);
		expect(health.hasBothModels).toBe(true);
		expect(matchesGenerationHealthChip(health, "swapped")).toBe(true);
	});

	it("does not flag a swap when only the prefix differs", () => {
		const health = classifyGenerationHealth({
			"gen_ai.request.model": "openai/gpt-4o",
			"gen_ai.response.model": "gpt-4o",
		});
		expect(health.modelSwap).toBe(false);
	});

	it("does not treat a missing served model as a swap", () => {
		const health = classifyGenerationHealth({
			"gen_ai.request.model": "gpt-4o",
		});
		expect(health.modelSwap).toBe(false);
		expect(health.hasBothModels).toBe(false);
		expect(matchesGenerationHealthChip(health, "swapped")).toBe(false);
	});

	it("treats date-suffixed served models as a swap", () => {
		const health = classifyGenerationHealth({
			"gen_ai.request.model": "gpt-4o",
			"gen_ai.response.model": "gpt-4o-2024-08-06",
		});
		expect(health.modelSwap).toBe(true);
	});

	it("returns defaults when attrs is undefined", () => {
		const health = classifyGenerationHealth(undefined);
		expect(health.finishReasonRaw).toBe("");
		expect(health.requestedModel).toBe("");
		expect(health.servedModel).toBe("");
	});

	it("treats a non-numeric output-tokens value as absent", () => {
		const health = classifyGenerationHealth({
			"gen_ai.usage.output_tokens": "not-a-number",
		});
		expect(health.hasOutputTokens).toBe(false);
		expect(health.outputTokens).toBeNull();
	});

	it("defaults an unrecognized finish reason token to ok", () => {
		const health = classifyGenerationHealth({
			"gen_ai.response.finish_reasons": "some_unrecognized_reason",
			"gen_ai.usage.output_tokens": "5",
		});
		expect(health.finishCategory).toBe("ok");
	});

	it("classifies as unknown when there is no finish reason and output tokens are absent", () => {
		const health = classifyGenerationHealth({});
		expect(health.finishCategory).toBe("unknown");
		expect(health.hasFinishReason).toBe(false);
		expect(health.hasOutputTokens).toBe(false);
	});

	it("still matches empty when a truncated call has 0 output tokens", () => {
		const health = classifyGenerationHealth({
			"gen_ai.response.finish_reasons": "length",
			"gen_ai.usage.output_tokens": "0",
		});
		expect(health.finishCategory).toBe("truncated");
		expect(matchesGenerationHealthChip(health, "truncated")).toBe(true);
		expect(matchesGenerationHealthChip(health, "empty")).toBe(true);
	});
});

describe("classifyFromNormalizedTrace", () => {
	it("reads mapped row fields", () => {
		const health = classifyFromNormalizedTrace({
			finishReason: "length",
			model: "gpt-4o",
			responseModel: "gpt-4o-mini",
			completionTokens: "8",
		});
		expect(health.finishCategory).toBe("truncated");
		expect(health.modelSwap).toBe(true);
	});

	it("prefers SpanAttributes when mapped fields are placeholders", () => {
		const health = classifyFromNormalizedTrace({
			model: "-",
			responseModel: undefined,
			SpanAttributes: {
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.response.model": "gpt-4o-mini",
			},
		});
		expect(health.modelSwap).toBe(true);
	});
});

describe("helpers", () => {
	it("normalizes model names", () => {
		expect(normalizeModelName(" OpenAI/GPT-4o ")).toBe("gpt-4o");
	});

	it("tokenizes a raw finish reason string", () => {
		expect(finishReasonTokens("STOP")).toEqual(["stop"]);
		expect(finishReasonTokens("")).toEqual([]);
	});

	it("returns no tokens when the raw finish reason has no alphanumeric characters", () => {
		expect(finishReasonTokens("!!!")).toEqual([]);
	});

	it("merges resource and span attributes, spans winning on conflicts", () => {
		expect(
			spanGenerationHealthAttrs({
				resourceAttributes: { "service.name": "svc", shared: "resource" },
				spanAttributes: { "gen_ai.request.model": "gpt-4o", shared: "span" },
			})
		).toEqual({
			"service.name": "svc",
			shared: "span",
			"gen_ai.request.model": "gpt-4o",
		});
	});

	it("defaults to an empty object when neither attribute bag is present", () => {
		expect(spanGenerationHealthAttrs({})).toEqual({});
	});

	it("finds the first span matching any selected chip", () => {
		const spans = [
			{ traceId: "t-1", spanAttributes: { "http.method": "GET" } },
			{
				traceId: "t-1",
				spanAttributes: { "gen_ai.response.finish_reasons": "length" },
			},
		];
		expect(firstSpanMatchingGenerationHealth(spans, ["truncated"])).toBe(
			spans[1]
		);
	});

	it("returns undefined from firstSpanMatchingGenerationHealth when no chips are selected", () => {
		expect(
			firstSpanMatchingGenerationHealth(
				[{ traceId: "t-1", spanAttributes: {} }],
				undefined
			)
		).toBeUndefined();
		expect(
			firstSpanMatchingGenerationHealth(
				[{ traceId: "t-1", spanAttributes: {} }],
				[]
			)
		).toBeUndefined();
	});

	it("parses chip lists", () => {
		expect(isGenerationHealthChip("truncated")).toBe(true);
		expect(isGenerationHealthChip("loop")).toBe(false);
		expect(parseGenerationHealthChips(["truncated", "nope", "swapped"])).toEqual(
			["truncated", "swapped"]
		);
		expect(hasGenerationHealthFilter(["truncated"])).toBe(true);
		expect(hasGenerationHealthFilter(["nope"])).toBe(false);
		expect(hasGenerationHealthFilter(undefined)).toBe(false);
	});

	it("matches any selected chip against span attributes", () => {
		expect(
			spanMatchesAnyGenerationHealthChip(
				{ "gen_ai.response.finish_reasons": "length" },
				["truncated"]
			)
		).toBe(true);
		expect(
			spanMatchesAnyGenerationHealthChip(
				{ "gen_ai.response.finish_reasons": "stop" },
				["truncated", "filtered"]
			)
		).toBe(false);
		expect(
			spanMatchesAnyGenerationHealthChip(
				{ "gen_ai.response.finish_reasons": "length" },
				[]
			)
		).toBe(true);
	});

	it("returns all spans unchanged when no chips are selected", () => {
		const spans = [{ traceId: "t-1", spanAttributes: {} }];
		expect(listedSpansMatchingGenerationHealth(spans, undefined)).toBe(spans);
		expect(listedSpansMatchingGenerationHealth(spans, [])).toBe(spans);
	});

	it("groups spans without a traceId under a per-index fallback key", () => {
		const listed = listedSpansMatchingGenerationHealth(
			[
				{ spanAttributes: { "gen_ai.response.finish_reasons": "length" } },
				{ spanAttributes: { "gen_ai.response.finish_reasons": "stop" } },
			],
			["truncated"]
		);
		expect(listed).toHaveLength(1);
		expect(listed[0]?.spanAttributes?.["gen_ai.response.finish_reasons"]).toBe(
			"length"
		);
	});

	it("lists one matching span per trace", () => {
		const listed = listedSpansMatchingGenerationHealth(
			[
				{
					traceId: "t-1",
					spanAttributes: { "http.method": "GET" },
				},
				{
					traceId: "t-1",
					spanAttributes: {
						"gen_ai.request.model": "gpt-4o",
						"gen_ai.response.model": "gpt-4o-mini",
					},
				},
				{
					traceId: "t-2",
					spanAttributes: { "gen_ai.request.model": "gpt-4o" },
				},
			],
			["swapped"]
		);
		expect(listed).toHaveLength(1);
		expect(listed[0]?.traceId).toBe("t-1");
		expect(listed[0]?.spanAttributes?.["gen_ai.response.model"]).toBe(
			"gpt-4o-mini"
		);
	});

	it("counts distinct traces", () => {
		expect(
			uniqueTraceCount([
				{ traceId: "t-1" },
				{ traceId: "t-1" },
				{ traceId: "t-2" },
			])
		).toBe(2);
	});

	it("falls back to the raw span count when no span has a traceId", () => {
		expect(uniqueTraceCount([{}, {}, { traceId: "" }])).toBe(3);
	});

	it("returns 0% when the eligible set is empty", () => {
		expect(percentOfEligible(4, 0)).toBe(0);
		expect(percentOfEligible(4, 8)).toBe(50);
		expect(percentOfEligible(NaN, 8)).toBe(0);
		expect(percentOfEligible(4, NaN)).toBe(0);
	});
});

describe("generationHealthWhereSql", () => {
	it("returns empty when no chips are selected", () => {
		expect(generationHealthWhereSql([])).toBe("");
		expect(generationHealthWhereSql(undefined)).toBe("");
	});

	it("ORs selected chip predicates", () => {
		const sql = generationHealthWhereSql(["truncated", "swapped"]);
		expect(sql).toContain("OR");
		expect(sql).toContain("gen_ai.response.finish_reasons");
		expect(sql).toContain("gen_ai.request.model");
		expect(sql).toContain("gen_ai.response.model");
		expect(sql).toContain("length");
		expect(sql).toContain("replaceRegexpOne");
	});
});
