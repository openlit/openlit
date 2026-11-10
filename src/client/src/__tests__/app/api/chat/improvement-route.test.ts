/**
 * @jest-environment node
 *
 * Keeps the real chat config and trace analysis code, so it proves that a saved
 * OpenAI-compatible config with no base URL ends in the route's error path.
 */
jest.mock('@/helpers/server/auth', () => ({ resolveRequestAuth: jest.fn() }));
jest.mock('@/lib/session', () => ({ getCurrentUser: jest.fn() }));
jest.mock('@/lib/db-config', () => ({ getDBConfigByUser: jest.fn() }));
jest.mock('@/lib/posthog', () => ({ __esModule: true, default: { fireEvent: jest.fn() } }));
jest.mock('@/lib/platform/common', () => {
	const collector = jest.fn();
	return { dataCollector: collector, intelligenceDataCollector: collector };
});
jest.mock('@/lib/platform/vault', () => ({ getSecretById: jest.fn() }));
jest.mock('@/lib/platform/providers/create-model', () => ({ createModel: jest.fn() }));
jest.mock('@/lib/platform/traces/read', () => ({ getTraceHierarchy: jest.fn() }));

import { POST } from '@/app/api/chat/improvement/[spanId]/route';
import { resolveRequestAuth } from '@/helpers/server/auth';
import { dataCollector } from '@/lib/platform/common';
import { createModel } from '@/lib/platform/providers/create-model';
import PostHogServer from '@/lib/posthog';
import { SERVER_EVENTS } from '@/constants/events';
import getMessage from '@/constants/messages';

describe('POST /api/chat/improvement/[spanId]', () => {
	it('reports a missing OpenAI-compatible base URL through the error path', async () => {
		(resolveRequestAuth as jest.Mock).mockResolvedValue([
			null,
			{ databaseConfigId: 'db-1', via: 'apiKey' },
		]);
		(dataCollector as jest.Mock).mockImplementation(async ({ query }: { query: string }) =>
			query.includes('openlit_chat_config')
				? { data: [{ provider: 'openai-compatible', model: 'llama3', vaultId: '' }] }
				: { data: [{ provider_id: 'openai-compatible', base_url: null }] }
		);

		const res = await POST(new Request('http://localhost/api/chat/improvement/span-1', { method: 'POST' }), {
			params: { spanId: 'span-1' },
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toBe(getMessage().OPENAI_COMPATIBLE_BASE_URL_REQUIRED);
		expect(createModel).not.toHaveBeenCalled();
		expect(PostHogServer.fireEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event: SERVER_EVENTS.AI_ANALYSIS_RUN_FAILURE })
		);
	});
});
