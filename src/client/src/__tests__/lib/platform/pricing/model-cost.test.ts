jest.mock('@/lib/platform/providers/provider-registry', () => ({
	ProviderRegistry: { getModel: jest.fn() },
}));
jest.mock('@/utils/log', () => ({ consoleLog: jest.fn() }));

import { ProviderRegistry } from '@/lib/platform/providers/provider-registry';
import { getModelCostCalculator } from '@/lib/platform/pricing/model-cost';

const getModel = ProviderRegistry.getModel as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('getModelCostCalculator', () => {
	it("prices usage with the model's Manage Models prices", async () => {
		getModel.mockResolvedValue({ inputPricePerMToken: 1, outputPricePerMToken: 2 });
		const costOf = await getModelCostCalculator('openai-compatible', 'local-llama-3', 'db-1');
		expect(getModel).toHaveBeenCalledWith('openai-compatible', 'local-llama-3', 'db-1');
		expect(costOf({ promptTokens: 42, completionTokens: 27 })).toBeCloseTo(0.000096, 9);
	});

	it('looks the prices up once for every call it prices', async () => {
		getModel.mockResolvedValue({ inputPricePerMToken: 1, outputPricePerMToken: 1 });
		const costOf = await getModelCostCalculator('openai', 'gpt-4o', 'db-1');
		costOf({ promptTokens: 1, completionTokens: 1 });
		costOf({ promptTokens: 1, completionTokens: 1 });
		expect(getModel).toHaveBeenCalledTimes(1);
	});

	it('bills cached prompt tokens at the cache price', async () => {
		getModel.mockResolvedValue({
			inputPricePerMToken: 10,
			outputPricePerMToken: 0,
			cacheReadPricePerMToken: 1,
		});
		const costOf = await getModelCostCalculator('anthropic', 'claude', 'db-1');
		expect(
			costOf({ promptTokens: 1_000_000, completionTokens: 0, cacheReadTokens: 500_000 })
		).toBeCloseTo(5.5, 9);
	});

	it('costs nothing for a model with no prices instead of guessing a rate', async () => {
		getModel.mockResolvedValue(null);
		const costOf = await getModelCostCalculator('openai-compatible', 'unknown', 'db-1');
		expect(costOf({ promptTokens: 1000, completionTokens: 1000 })).toBe(0);
	});

	it('costs nothing when the lookup fails', async () => {
		getModel.mockRejectedValue(new Error('clickhouse down'));
		const costOf = await getModelCostCalculator('openai', 'gpt-4o', 'db-1');
		expect(costOf({ promptTokens: 1000, completionTokens: 1000 })).toBe(0);
	});

	it('skips the lookup without a provider or model', async () => {
		const costOf = await getModelCostCalculator('', 'gpt-4o');
		expect(costOf({ promptTokens: 1, completionTokens: 1 })).toBe(0);
		expect(getModel).not.toHaveBeenCalled();
	});
});
