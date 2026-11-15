jest.mock('@/lib/prisma', () => ({
	__esModule: true,
	default: {
		databaseConfigUser: { findUnique: jest.fn() },
		organisationUser: { findUnique: jest.fn() },
	},
}));
jest.mock('@/lib/instance-admin', () => ({ isInstanceAdminUser: jest.fn() }));

import prisma from '@/lib/prisma';
import { isInstanceAdminUser } from '@/lib/instance-admin';
import { canConfigureModelEndpoint } from '@/lib/access/model-endpoint-route';

const configAccess = (canEdit: boolean, organisationId: string | null = 'org-1') =>
	(prisma.databaseConfigUser.findUnique as jest.Mock).mockResolvedValue({
		canEdit,
		databaseConfig: { project: organisationId ? { organisationId } : null },
	});

const membership = (role: string, createdByUserId = 'someone-else') =>
	(prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({
		role,
		organisation: { createdByUserId },
	});

beforeEach(() => {
	jest.resetAllMocks();
	(isInstanceAdminUser as jest.Mock).mockResolvedValue(false);
});

describe('canConfigureModelEndpoint', () => {
	it('allows the instance admin without looking at the configuration', async () => {
		(isInstanceAdminUser as jest.Mock).mockResolvedValue(true);
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(true);
		expect(prisma.databaseConfigUser.findUnique).not.toHaveBeenCalled();
	});

	it.each(['owner', 'admin'])('allows an organisation %s who can edit the configuration', async (role) => {
		configAccess(true);
		membership(role);
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(true);
		expect(prisma.databaseConfigUser.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { databaseConfigId_userId: { databaseConfigId: 'db-1', userId: 'u1' } },
			})
		);
	});

	it("checks the role in the configuration's organisation, not the current one", async () => {
		configAccess(true, 'org-of-config');
		membership('owner');
		await canConfigureModelEndpoint('u1', 'db-1');
		expect(prisma.organisationUser.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { organisationId_userId: { organisationId: 'org-of-config', userId: 'u1' } },
			})
		);
	});

	it('denies an owner who can only view the configuration', async () => {
		configAccess(false);
		membership('owner');
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(false);
	});

	it('denies a user with no access to the configuration', async () => {
		(prisma.databaseConfigUser.findUnique as jest.Mock).mockResolvedValue(null);
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(false);
		expect(prisma.organisationUser.findUnique).not.toHaveBeenCalled();
	});

	it('denies a configuration that belongs to no project', async () => {
		configAccess(true, null);
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(false);
	});

	it('denies someone outside the configuration organisation', async () => {
		configAccess(true);
		(prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue(null);
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(false);
	});

	it('allows the organisation creator who can edit the configuration', async () => {
		configAccess(true);
		membership('member', 'u1');
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(true);
	});

	it('denies a regular member who can edit the configuration', async () => {
		configAccess(true);
		membership('member');
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(false);
	});
});
