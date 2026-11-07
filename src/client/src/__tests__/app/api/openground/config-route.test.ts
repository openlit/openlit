jest.mock('@/lib/audit/route', () => ({ withAudit: (h: any) => h }));
jest.mock('@/lib/rbac/current', () => ({
	withCurrentOrganisationPermission: (_k: string, h: any) => h,
}));
jest.mock('@/lib/session', () => ({ getCurrentUser: jest.fn() }));
jest.mock('@/lib/db-config', () => ({ getDBConfigByUser: jest.fn() }));
jest.mock('@/lib/posthog', () => ({ __esModule: true, default: { fireEvent: jest.fn() } }));
jest.mock('@/lib/platform/providers/config', () => ({
	getOpenGroundConfigs: jest.fn(),
	upsertOpenGroundConfig: jest.fn(),
	deleteOpenGroundConfig: jest.fn(),
	toggleOpenGroundConfigStatus: jest.fn(),
}));
jest.mock('@/lib/platform/vault', () => ({ isOwnSecret: jest.fn() }));
jest.mock('@/utils/asaw', () =>
	jest.fn(async (promise: Promise<any>) => {
		try {
			return [null, await promise];
		} catch (error) {
			return [error, null];
		}
	})
);
jest.mock('next/server', () => ({
	NextRequest: class {},
	NextResponse: {
		json: (body: unknown, init?: { status?: number }) => ({
			body,
			status: init?.status ?? 200,
		}),
	},
}));

import { POST } from '@/app/api/openground/config/route';
import { getCurrentUser } from '@/lib/session';
import { getDBConfigByUser } from '@/lib/db-config';
import { upsertOpenGroundConfig } from '@/lib/platform/providers/config';
import { isOwnSecret } from '@/lib/platform/vault';
import * as messages from '@/constants/messages/en';

function req(body: unknown, raw = false) {
	return {
		json: async () => {
			if (raw) throw new SyntaxError('Unexpected token');
			return body;
		},
	} as any;
}

beforeEach(() => {
	jest.clearAllMocks();
	(getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1' });
	(getDBConfigByUser as jest.Mock).mockResolvedValue({ id: 'db-1' });
	(isOwnSecret as jest.Mock).mockResolvedValue(true);
});

describe('POST /api/openground/config', () => {
	it('returns 400 for malformed JSON instead of 500', async () => {
		const res: any = await (POST as any)(req(null, true));
		expect(res.status).toBe(400);
		expect(upsertOpenGroundConfig).not.toHaveBeenCalled();
	});

	it('rejects evaluation-only providers with 400 before touching the library', async () => {
		const res: any = await (POST as any)(
			req({ provider: 'typesafe', vaultId: 'v1', modelId: 'jev-latest' })
		);
		expect(res.status).toBe(400);
		expect(res.body.error).toContain('evaluation-only');
		expect(upsertOpenGroundConfig).not.toHaveBeenCalled();
	});

	it('still saves chat providers', async () => {
		(upsertOpenGroundConfig as jest.Mock).mockResolvedValue({ data: { id: 'c1' } });
		const res: any = await (POST as any)(
			req({ provider: 'openai', vaultId: 'v1', modelId: 'gpt-4o' })
		);
		expect(res.status).toBe(200);
		expect(upsertOpenGroundConfig).toHaveBeenCalledTimes(1);
	});
});

describe('POST /api/openground/config key handling', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
		(getDBConfigByUser as jest.Mock).mockResolvedValue({ id: 'db-1' });
		(upsertOpenGroundConfig as jest.Mock).mockResolvedValue({ data: { id: 'cfg-1' } });
	});

	it('accepts the OpenAI-compatible provider without a vault id', async () => {
		const res: any = await POST(req({ provider: 'openai-compatible' }));
		expect(res.status).toBe(200);
		expect(upsertOpenGroundConfig).toHaveBeenCalledWith(
			expect.objectContaining({ provider: 'openai-compatible', vaultId: '' })
		);
	});

	it('still requires a vault id for other providers', async () => {
		const res: any = await POST(req({ provider: 'openai' }));
		expect(res.status).toBe(400);
		expect(upsertOpenGroundConfig).not.toHaveBeenCalled();
	});

	it("rejects a vault id the caller does not own", async () => {
		(isOwnSecret as jest.Mock).mockResolvedValue(false);
		const res: any = await (POST as any)(
			req({ provider: 'openai-compatible', vaultId: 'victim-secret' })
		);
		expect(res).toEqual({ status: 403, body: { error: messages.VAULT_SECRET_NOT_OWNED } });
		expect(isOwnSecret).toHaveBeenCalledWith('victim-secret', 'db-1');
		expect(upsertOpenGroundConfig).not.toHaveBeenCalled();
	});

	it('does not check ownership when no key is selected', async () => {
		(upsertOpenGroundConfig as jest.Mock).mockResolvedValue({ data: {} });
		await (POST as any)(req({ provider: 'openai-compatible' }));
		expect(isOwnSecret).not.toHaveBeenCalled();
		expect(upsertOpenGroundConfig).toHaveBeenCalled();
	});
});
