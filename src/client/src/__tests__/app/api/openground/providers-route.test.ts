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
jest.mock('@/lib/platform/providers/config', () => ({
	clearOpenAICompatibleKeys: jest.fn(),
}));
jest.mock('@/lib/access/model-endpoint-route', () => ({
	canConfigureModelEndpoint: jest.fn(),
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
import { clearOpenAICompatibleKeys } from '@/lib/platform/providers/config';
import { canConfigureModelEndpoint } from '@/lib/access/model-endpoint-route';
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
	(canConfigureModelEndpoint as jest.Mock).mockResolvedValue(true);
	(clearOpenAICompatibleKeys as jest.Mock).mockResolvedValue({});
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

	it('refuses a URL change from someone who cannot configure endpoints', async () => {
		(canConfigureModelEndpoint as jest.Mock).mockResolvedValue(false);
		const res = await put({ providerId: 'openai-compatible', baseUrl: 'https://attacker.example.com/v1' });
		expect(res).toEqual({ status: 403, body: { error: getMessage().MODEL_ENDPOINT_ADMIN_REQUIRED } });
		expect(canConfigureModelEndpoint).toHaveBeenCalledWith('user-1');
		expect(insertedRow()).toBeUndefined();
		expect(clearOpenAICompatibleKeys).not.toHaveBeenCalled();
	});

	it('lets anyone edit other fields when the form resends the same URL', async () => {
		(canConfigureModelEndpoint as jest.Mock).mockResolvedValue(false);
		const res = await put({
			providerId: 'openai-compatible',
			displayName: 'Local',
			baseUrl: existingRow.base_url,
		});
		expect(res.status).toBe(200);
		expect(insertedRow()).toMatchObject({ display_name: 'Local', base_url: existingRow.base_url });
		expect(clearOpenAICompatibleKeys).not.toHaveBeenCalled();
	});

	it('clears saved keys before storing a new URL', async () => {
		await put({ providerId: 'openai-compatible', baseUrl: 'http://new.internal/v1' });
		expect(clearOpenAICompatibleKeys).toHaveBeenCalledWith('db-1');
		const clearOrder = (clearOpenAICompatibleKeys as jest.Mock).mock.invocationCallOrder[0];
		const insertIndex = (dataCollector as jest.Mock).mock.calls.findIndex((c) => c[1] === 'insert');
		expect(clearOrder).toBeLessThan((dataCollector as jest.Mock).mock.invocationCallOrder[insertIndex]);
	});

	it('keeps the old URL when saved keys cannot be cleared', async () => {
		(clearOpenAICompatibleKeys as jest.Mock).mockResolvedValue({ err: 'boom' });
		const res = await put({ providerId: 'openai-compatible', baseUrl: 'http://new.internal/v1' });
		expect(res.status).toBe(500);
		expect(insertedRow()).toBeUndefined();
	});

	it('does not clear keys for a URL it rejects', async () => {
		(assertModelEndpointAllowed as jest.Mock).mockRejectedValue(new Error('blocked'));
		await put({ providerId: 'openai-compatible', baseUrl: 'http://169.254.169.254' });
		expect(clearOpenAICompatibleKeys).not.toHaveBeenCalled();
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
