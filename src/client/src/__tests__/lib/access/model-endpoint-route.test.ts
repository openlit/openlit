jest.mock('@/lib/prisma', () => ({
	__esModule: true,
	default: { organisationUser: { findFirst: jest.fn() } },
}));
jest.mock('@/lib/instance-admin', () => ({ isInstanceAdminUser: jest.fn() }));

import prisma from '@/lib/prisma';
import { isInstanceAdminUser } from '@/lib/instance-admin';
import { canConfigureModelEndpoint } from '@/lib/access/model-endpoint-route';

const membership = (role: string, createdByUserId = 'someone-else') =>
	(prisma.organisationUser.findFirst as jest.Mock).mockResolvedValue({
		role,
		organisation: { createdByUserId },
	});

beforeEach(() => {
	jest.resetAllMocks();
	(isInstanceAdminUser as jest.Mock).mockResolvedValue(false);
});

describe('canConfigureModelEndpoint', () => {
	it('allows the instance admin, even without a current organisation', async () => {
		(isInstanceAdminUser as jest.Mock).mockResolvedValue(true);
		await expect(canConfigureModelEndpoint('u1')).resolves.toBe(true);
	});

	it.each(['owner', 'admin'])('allows an organisation %s', async (role) => {
		membership(role);
		await expect(canConfigureModelEndpoint('u1')).resolves.toBe(true);
	});

	it('allows the organisation creator', async () => {
		membership('member', 'u1');
		await expect(canConfigureModelEndpoint('u1')).resolves.toBe(true);
	});

	it('denies a regular member', async () => {
		membership('member');
		await expect(canConfigureModelEndpoint('u1')).resolves.toBe(false);
	});

	it('denies a user with no current organisation', async () => {
		(prisma.organisationUser.findFirst as jest.Mock).mockResolvedValue(null);
		await expect(canConfigureModelEndpoint('u1')).resolves.toBe(false);
	});
});
