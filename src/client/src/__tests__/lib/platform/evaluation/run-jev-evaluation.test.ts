import { runJevEvaluation } from '@/lib/platform/evaluation/run-jev-evaluation';

const originalFetch = global.fetch;

afterEach(() => {
	global.fetch = originalFetch;
	jest.restoreAllMocks();
});

describe('runJevEvaluation', () => {
	it('posts to /v1/systemone and does not call generateText', async () => {
		const fetchMock = jest.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({
					model: 'jev-1.13.0',
					answers: {
						hallucination: { type: 'noul', noul: 0.2 },
						bias: { type: 'noul', noul: 0 },
						toxicity: { type: 'noul', noul: 0 },
					},
					usage: { input_tokens: 40, output_tokens: 8 },
				}),
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		const result = await runJevEvaluation({
			apiKey: 'ts-key',
			model: 'jev-latest',
			prompt: 'hi',
			response: 'hello',
		});

		expect(result.success).toBe(true);
		expect(result.usage).toEqual({ promptTokens: 40, completionTokens: 8 });
		expect(result.extraMeta?.engine).toBe('typesafe');
		expect(result.extraMeta?.resolvedModel).toBe('jev-1.13.0');
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.typesafe.ai/v1/systemone',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					Authorization: 'Bearer ts-key',
				}),
			})
		);
		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body.questions.hallucination.type).toBe('noul');
	});

	it('retries 429 then succeeds', async () => {
		const fetchMock = jest
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 429,
				text: async () => 'rate limited',
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: async () =>
					JSON.stringify({
						model: 'jev-latest',
						answers: { hallucination: { type: 'noul', noul: 0 } },
					}),
			});
		global.fetch = fetchMock as unknown as typeof fetch;
		jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
			fn();
			return 0 as unknown as NodeJS.Timeout;
		});

		const result = await runJevEvaluation({
			apiKey: 'ts-key',
			model: 'jev-latest',
			evaluationTypes: [{ id: 'hallucination', label: 'Hallucination' }],
		});

		expect(result.success).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('returns failure when System One is not ok', async () => {
		global.fetch = jest.fn().mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => 'unauthorized',
		}) as unknown as typeof fetch;

		const result = await runJevEvaluation({
			apiKey: 'bad',
			model: 'jev-latest',
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain('401');
	});
});
