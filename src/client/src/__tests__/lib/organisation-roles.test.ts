jest.mock('@/lib/prisma', () => ({
	__esModule: true,
	default: { organisationUser: { findUnique: jest.fn() } },
}));
jest.mock('@/features/organisation-access', () => ({ canManageOrganisation: jest.fn() }));

import prisma from '@/lib/prisma';
import { canManageOrganisation } from '@/features/organisation-access';
import { hasAdminOrOwnerRole } from '@/lib/organisation-roles';

const findUnique = prisma.organisationUser.findUnique as jest.Mock;

beforeEach(() => {
	jest.resetAllMocks();
	(canManageOrganisation as jest.Mock).mockResolvedValue(undefined);
});

describe('hasAdminOrOwnerRole', () => {
	it.each(['owner', 'admin'])('allows an organisation %s', async (role) => {
		findUnique.mockResolvedValue({ role });
		await expect(hasAdminOrOwnerRole('org-1', 'u1', 'organisation.update')).resolves.toBe(true);
	});

	it('denies a member and a non-member', async () => {
		findUnique.mockResolvedValue({ role: 'member' });
		await expect(hasAdminOrOwnerRole('org-1', 'u1', 'organisation.update')).resolves.toBe(false);
		findUnique.mockResolvedValue(null);
		await expect(hasAdminOrOwnerRole('org-1', 'u1', 'organisation.update')).resolves.toBe(false);
	});

	it.each([true, false])('lets the extension hook decide when it answers (%s)', async (decision) => {
		(canManageOrganisation as jest.Mock).mockResolvedValue(decision);
		await expect(hasAdminOrOwnerRole('org-1', 'u1', 'members.invite')).resolves.toBe(decision);
		expect(canManageOrganisation).toHaveBeenCalledWith({
			organisationId: 'org-1',
			userId: 'u1',
			action: 'members.invite',
		});
		expect(findUnique).not.toHaveBeenCalled();
	});
});
