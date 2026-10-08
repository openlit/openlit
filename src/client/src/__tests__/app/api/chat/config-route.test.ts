jest.mock('@/helpers/server/auth', () => ({ resolveRequestAuth: jest.fn() }));
jest.mock('@/lib/platform/chat/config', () => ({
	getChatConfig: jest.fn(),
	upsertChatConfig: jest.fn(),
}));

import { POST } from '@/app/api/chat/config/route';
import { resolveRequestAuth } from '@/helpers/server/auth';
import { upsertChatConfig } from '@/lib/platform/chat/config';

const authed = () =>
	(resolveRequestAuth as jest.Mock).mockResolvedValue([null, { databaseConfigId: 'db-1' }]);

function req(body: unknown, raw = false) {
	return {
		json: async () => {
			if (raw) throw new SyntaxError('Unexpected token');
			return body;
		},
	} as any;
}

beforeEach(() => jest.clearAllMocks());

describe('POST /api/chat/config', () => {
	it('returns 401 when unauthenticated', async () => {
		(resolveRequestAuth as jest.Mock).mockResolvedValue(['err', null]);
		const res = await POST(req({}));
		expect(res.status).toBe(401);
	});

	it('returns 400 for malformed JSON instead of throwing', async () => {
		authed();
		const res = await POST(req(null, true));
		expect(res.status).toBe(400);
		expect(upsertChatConfig).not.toHaveBeenCalled();
	});

	it('returns 400 when required fields are missing', async () => {
		authed();
		const res = await POST(req({ provider: 'openai' }));
		expect(res.status).toBe(400);
	});

	it('passes the evaluation-only provider rejection through as 400', async () => {
		authed();
		(upsertChatConfig as jest.Mock).mockResolvedValue({
			err: 'This provider is evaluation-only and cannot be used here',
		});
		const res = await POST(
			req({ provider: 'typesafe', model: 'jev-latest', vaultId: 'v1' })
		);
		expect(res.status).toBe(400);
	});

	it('returns the saved result for chat providers', async () => {
		authed();
		(upsertChatConfig as jest.Mock).mockResolvedValue({ data: 'saved' });
		const res = await POST(
			req({ provider: 'openai', model: 'gpt-4o', vaultId: 'v1' })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ data: 'saved' });
	});
});
