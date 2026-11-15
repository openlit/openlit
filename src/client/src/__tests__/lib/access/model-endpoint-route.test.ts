jest.mock('@/lib/prisma', () => ({
	__esModule: true,
	default: {
		databaseConfigUser: { findUnique: jest.fn() },
	},
}));
jest.mock('@/lib/instance-admin', () => ({ isInstanceAdminUser: jest.fn() }));
jest.mock('@/lib/organisation-roles', () => ({ hasAdminOrOwnerRole: jest.fn() }));

import prisma from '@/lib/prisma';
import { isInstanceAdminUser } from '@/lib/instance-admin';
import { canConfigureModelEndpoint } from '@/lib/access/model-endpoint-route';
import { hasAdminOrOwnerRole } from '@/lib/organisation-roles';

const configAccess = (canEdit: boolean, organisationId: string | null = 'org-1') =>
	(prisma.databaseConfigUser.findUnique as jest.Mock).mockResolvedValue({
		canEdit,
		databaseConfig: { project: organisationId ? { organisationId } : null },
	});

const canManage = (allowed: boolean) =>
	(hasAdminOrOwnerRole as jest.Mock).mockResolvedValue(allowed);

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

	it('allows someone who can edit the configuration and manage its organisation', async () => {
		configAccess(true);
		canManage(true);
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(true);
		expect(prisma.databaseConfigUser.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { databaseConfigId_userId: { databaseConfigId: 'db-1', userId: 'u1' } },
			})
		);
	});

	it("uses CE's organisation rule for the configuration's organisation, not the current one", async () => {
		configAccess(true, 'org-of-config');
		canManage(true);
		await canConfigureModelEndpoint('u1', 'db-1');
		expect(hasAdminOrOwnerRole).toHaveBeenCalledWith('org-of-config', 'u1', 'organisation.update');
	});

	it('denies someone who cannot manage the organisation', async () => {
		configAccess(true);
		canManage(false);
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(false);
	});

	it('denies an organisation manager who can only view the configuration', async () => {
		configAccess(false);
		canManage(true);
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(false);
		expect(hasAdminOrOwnerRole).not.toHaveBeenCalled();
	});

	it('denies a user with no access to the configuration', async () => {
		(prisma.databaseConfigUser.findUnique as jest.Mock).mockResolvedValue(null);
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(false);
		expect(hasAdminOrOwnerRole).not.toHaveBeenCalled();
	});

	it('denies a configuration that belongs to no project', async () => {
		configAccess(true, null);
		await expect(canConfigureModelEndpoint('u1', 'db-1')).resolves.toBe(false);
	});
});
