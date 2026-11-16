jest.mock('@/lib/rbac/current', () => ({
	withCurrentOrganisationPermission: (_k: string, h: any) => h,
}));
jest.mock('@/lib/session', () => ({ getCurrentUser: jest.fn() }));
jest.mock('@/lib/db-config', () => ({ getDBConfigByUser: jest.fn() }));
jest.mock('@/lib/platform/openground-clickhouse', () => ({
	getOpengroundEvaluationById: jest.fn(),
}));

import { GET } from '@/app/api/openground/[id]/route';
import { getCurrentUser } from '@/lib/session';
import { getDBConfigByUser } from '@/lib/db-config';
import { getOpengroundEvaluationById } from '@/lib/platform/openground-clickhouse';
import getMessage from '@/constants/messages';

const call = () => (GET as any)({}, { params: { id: 'run-1' } });

describe('GET /api/openground/[id]', () => {
	beforeEach(() => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1' });
		(getDBConfigByUser as jest.Mock).mockResolvedValue({ id: 'db1' });
	});

	it('returns 404 when the run does not exist', async () => {
		(getOpengroundEvaluationById as jest.Mock).mockResolvedValue({
			err: getMessage().OPENGROUND_RUN_NOT_FOUND,
			notFound: true,
		});
		const res = await call();
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: getMessage().OPENGROUND_RUN_NOT_FOUND });
	});

	it('returns 500 when the query fails', async () => {
		(getOpengroundEvaluationById as jest.Mock).mockResolvedValue({
			err: getMessage().OPENGROUND_FETCH_FAILED,
		});
		const res = await call();
		expect(res.status).toBe(500);
	});

	it('returns the run when found', async () => {
		(getOpengroundEvaluationById as jest.Mock).mockResolvedValue({ data: { id: 'run-1' } });
		const res = await call();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: 'run-1' });
	});
});
