import {
	getChatModelCostPerM,
	promptTokensIncludeCache,
} from "@/lib/platform/pricing/chat-cost";

describe("getChatModelCostPerM", () => {
	const claudePrices = {
		inputPricePerMToken: 3,
		outputPricePerMToken: 15,
		cacheReadPricePerMToken: 0.3,
		cacheCreationPricePerMToken: 3.75,
	};

	it("matches legacy input+output when cache prices are zero", () => {
		const cost = getChatModelCostPerM(
			{
				inputPricePerMToken: 2.5,
				outputPricePerMToken: 10,
			},
			{ promptTokens: 1_000_000, completionTokens: 1_000_000 }
		);
		expect(cost).toBeCloseTo(12.5, 8);
	});

	it("prices exclusive Anthropic-style cache tokens on top of prompt", () => {
		// 200 uncached + 5000 cache read + 1000 cache create + 300 out
		const cost = getChatModelCostPerM(
			claudePrices,
			{
				promptTokens: 200,
				completionTokens: 300,
				cacheReadTokens: 5000,
				cacheCreationTokens: 1000,
			},
			{ promptTokensIncludeCache: false }
		);
		// 200/1e6*3 + 300/1e6*15 + 5000/1e6*0.3 + 1000/1e6*3.75
		expect(cost).toBeCloseTo(0.01035, 8);
	});

	it("subtracts cache from inclusive prompt totals", () => {
		const cost = getChatModelCostPerM(
			claudePrices,
			{
				promptTokens: 6200,
				completionTokens: 300,
				cacheReadTokens: 5000,
				cacheCreationTokens: 1000,
			},
			{ promptTokensIncludeCache: true }
		);
		expect(cost).toBeCloseTo(0.01035, 8);
	});
});

describe("promptTokensIncludeCache", () => {
	it("treats anthropic and bedrock as exclusive", () => {
		expect(promptTokensIncludeCache("anthropic", 6200, 5000, 1000)).toBe(
			false
		);
		expect(promptTokensIncludeCache("bedrock", 6200, 5000, 1000)).toBe(false);
	});

	it("treats openai and litellm as inclusive", () => {
		expect(promptTokensIncludeCache("openai", 6200, 5000, 1000)).toBe(true);
		expect(promptTokensIncludeCache("litellm", 6200, 5000, 1000)).toBe(true);
	});

	it("falls back to heuristic when provider unknown", () => {
		expect(promptTokensIncludeCache("unknown", 6200, 5000, 1000)).toBe(true);
		expect(promptTokensIncludeCache("unknown", 200, 5000, 1000)).toBe(false);
	});
});
