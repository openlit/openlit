jest.mock('@/lib/audit/route', () => ({ withAudit: (h: any) => h }));
jest.mock('@/lib/rbac/current', () => ({
	withCurrentOrganisationPermission: (_k: string, h: any) => h,
}));
jest.mock('@/lib/session', () => ({ getCurrentUser: jest.fn() }));
jest.mock('@/lib/db-config', () => ({ getDBConfigByUser: jest.fn() }));
jest.mock('@/lib/platform/common', () => ({ dataCollector: jest.fn() }));
jest.mock('@/lib/platform/providers/provider-service', () => ({}));
jest.mock('@/lib/platform/providers/create-model', () => ({
	assertModelEndpointAllowed: jest.fn(),
}));
jest.mock('next/server', () => ({
	NextRequest: class {},
	NextResponse: {
		json: (body: unknown, init?: { status?: number }) => ({
			body,
			status: init?.status ?? 200,
		}),
	},
}));

import { PUT } from '@/app/api/openground/providers/route';
import { getCurrentUser } from '@/lib/session';
import { getDBConfigByUser } from '@/lib/db-config';
import { dataCollector } from '@/lib/platform/common';
import { assertModelEndpointAllowed } from '@/lib/platform/providers/create-model';
import getMessage from '@/constants/messages';

const existingRow = {
	provider_id: 'openai-compatible',
	display_name: 'OpenAI-compatible',
	description: '',
	requires_vault: false,
	config_schema: '{}',
	base_url: 'http://old.internal/v1',
	is_default: true,
};

const put = (body: unknown) =>
	PUT({ json: async () => body } as any) as unknown as Promise<{ status: number; body: any }>;

function insertedRow() {
	const call = (dataCollector as jest.Mock).mock.calls.find((c) => c[1] === 'insert');
	return call?.[0].values[0];
}

beforeEach(() => {
	jest.clearAllMocks();
	(getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
	(getDBConfigByUser as jest.Mock).mockResolvedValue({ id: 'db-1' });
	(dataCollector as jest.Mock).mockImplementation(async (_p: unknown, type: string) =>
		type === 'query' ? { data: [existingRow] } : {}
	);
	(assertModelEndpointAllowed as jest.Mock).mockResolvedValue(new URL('http://llm.internal/v1'));
});

describe('PUT /api/openground/providers base URL', () => {
	it('validates and stores a trimmed base URL', async () => {
		const res = await put({ providerId: 'openai-compatible', baseUrl: ' http://llm.internal/v1 ' });
		expect(res.status).toBe(200);
		expect(assertModelEndpointAllowed).toHaveBeenCalledWith('http://llm.internal/v1');
		expect(insertedRow().base_url).toBe('http://llm.internal/v1');
	});

	it('rejects a disallowed URL without writing', async () => {
		(assertModelEndpointAllowed as jest.Mock).mockRejectedValue(new Error('blocked'));
		const res = await put({ providerId: 'openai-compatible', baseUrl: 'http://169.254.169.254' });
		expect(res).toEqual({ status: 400, body: { error: getMessage().MODEL_ENDPOINT_NOT_ALLOWED } });
		expect(insertedRow()).toBeUndefined();
	});

	it('clears the base URL when it is blanked', async () => {
		await put({ providerId: 'openai-compatible', baseUrl: '' });
		expect(insertedRow().base_url).toBeNull();
		expect(assertModelEndpointAllowed).not.toHaveBeenCalled();
	});

	it('keeps the stored URL when the field is absent', async () => {
		await put({ providerId: 'openai-compatible', displayName: 'Local' });
		expect(insertedRow().base_url).toBe('http://old.internal/v1');
	});

	it('ignores a base URL sent for a vendor provider', async () => {
		(dataCollector as jest.Mock).mockImplementation(async (_p: unknown, type: string) =>
			type === 'query' ? { data: [{ ...existingRow, provider_id: 'openai', base_url: null }] } : {}
		);
		await put({ providerId: 'openai', baseUrl: 'https://attacker.example.com/v1' });
		expect(insertedRow().base_url).toBeNull();
		expect(assertModelEndpointAllowed).not.toHaveBeenCalled();
	});
});
