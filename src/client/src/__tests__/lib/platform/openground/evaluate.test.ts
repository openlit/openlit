const order: string[] = [];

jest.mock('@/lib/platform/openground/ai-sdk-adapter', () => ({
	AISdkAdapter: { generateCompletion: jest.fn() },
}));
jest.mock('@/lib/platform/providers/config', () => ({
	getOpenGroundConfigWithSecret: jest.fn(),
}));
jest.mock('@/lib/platform/providers/provider-registry', () => ({
	ProviderRegistry: { getBaseUrl: jest.fn() },
}));
jest.mock('@/lib/platform/pricing/model-cost', () => ({
	getModelCostCalculator: jest.fn(async () => () => 0),
}));
jest.mock('@/lib/platform/openground-clickhouse', () => ({
	createOpengroundEvaluation: jest.fn(async () => ({ data: 'run-1' })),
}));
jest.mock('@/lib/platform/prompt', () => ({ getSpecificPrompt: jest.fn() }));

import { evaluate } from '@/lib/platform/openground/evaluate';
import { AISdkAdapter } from '@/lib/platform/openground/ai-sdk-adapter';
import { getOpenGroundConfigWithSecret } from '@/lib/platform/providers/config';
import { ProviderRegistry } from '@/lib/platform/providers/provider-registry';

beforeEach(() => {
	order.length = 0;
	(ProviderRegistry.getBaseUrl as jest.Mock).mockImplementation(async () => {
		order.push('url');
		return 'http://llm.internal/v1';
	});
	(getOpenGroundConfigWithSecret as jest.Mock).mockImplementation(async () => {
		order.push('key');
		return { data: { apiKey: 'local-key' } };
	});
	(AISdkAdapter.generateCompletion as jest.Mock).mockResolvedValue({
		text: 'hi',
		usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
		finishReason: 'stop',
	});
});

describe('OpenGround evaluate', () => {
	it('reads the base URL before the key reference and sends the key to that URL', async () => {
		await evaluate({
			promptSource: { type: 'custom', content: 'hello' },
			providers: [{ provider: 'openai-compatible', model: 'llama3', config: {} } as any],
			userId: 'u1',
			databaseConfigId: 'db-1',
		});

		expect(order).toEqual(['url', 'key']);
		expect(AISdkAdapter.generateCompletion).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: 'local-key', baseUrl: 'http://llm.internal/v1' })
		);
	});

	it('reports the sampling settings actually sent for models that reject them', async () => {
		const run = async (model: string) =>
			evaluate({
				promptSource: { type: 'custom', content: 'hello' },
				providers: [
					{ provider: 'anthropic', model, config: { temperature: 0.2, topP: 0.9, maxTokens: 50 } } as any,
				],
				userId: 'u1',
				databaseConfigId: 'db-1',
			});

		const newer = await run('claude-haiku-5-5');
		expect(newer.data?.[0].config).toEqual({ maxTokens: 50 });

		const older = await run('claude-sonnet-4-5');
		expect(older.data?.[0].config).toEqual({ temperature: 0.2, topP: 0.9, maxTokens: 50 });
	});
});
