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
