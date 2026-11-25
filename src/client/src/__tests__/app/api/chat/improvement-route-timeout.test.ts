/**
 * @jest-environment node
 */
jest.mock('@/helpers/server/auth', () => ({ resolveRequestAuth: jest.fn() }));
jest.mock('@/lib/db-config', () => ({ getDBConfigByUser: jest.fn() }));
jest.mock('@/lib/posthog', () => ({ __esModule: true, default: { fireEvent: jest.fn() } }));
jest.mock('@/lib/platform/chat/improvement', () => ({
	getTraceImprovement: jest.fn(),
	streamTraceImprovementAnalysis: jest.fn(),
}));

import { GET } from '@/app/api/chat/improvement/[spanId]/route';
import { resolveRequestAuth } from '@/helpers/server/auth';
import { getTraceImprovement } from '@/lib/platform/chat/improvement';

const get = () =>
	GET(new Request('http://localhost/api/chat/improvement/span-1'), {
		params: { spanId: 'span-1' },
	});

describe('GET /api/chat/improvement/[spanId] run timeout', () => {
	const inherited = process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS;

	afterAll(() => {
		if (inherited !== undefined) process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS = inherited;
	});

	beforeEach(() => {
		delete process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS;
		(resolveRequestAuth as jest.Mock).mockResolvedValue([
			null,
			{ databaseConfigId: 'db-1', via: 'apiKey' },
		]);
		(getTraceImprovement as jest.Mock).mockResolvedValue({
			data: { rootSpanId: 'span-1', runs: [] },
		});
	});

	afterEach(() => {
		delete process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS;
	});

	it('sends the default run timeout with the saved runs', async () => {
		const res = await get();

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			data: { rootSpanId: 'span-1', runs: [] },
			timeoutMs: 120_000,
		});
	});

	it('sends OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS when it is set', async () => {
		process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS = '1800000';

		const res = await get();

		expect((await res.json()).timeoutMs).toBe(1_800_000);
	});
});
