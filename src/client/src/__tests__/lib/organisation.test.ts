jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    organisation: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organisationUser: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    organisationInvitedUser: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    databaseConfigUser: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    databaseConfig: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));
jest.mock('@/lib/session', () => ({
  getCurrentUser: jest.fn(),
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    UNAUTHORIZED_USER: 'Unauthorized',
    NOT_ORGANISATION_MEMBER: 'Not a member',
    ORGANISATION_NOT_FOUND: 'Org not found',
    ORGANISATION_ONLY_CREATOR_CAN_DELETE: 'Only creator can delete',
    ORGANISATION_CANNOT_DELETE_WITH_MEMBERS: 'Cannot delete with members',
    ONLY_ADMIN_CAN_UPDATE_ORGANISATION: 'Only admin can update',
    ORGANISATION_NOTHING_TO_UPDATE: 'Nothing to update',
    ONLY_ADMIN_CAN_INVITE: 'Only admin can invite',
    USER_ALREADY_ORGANISATION_MEMBER: 'Already a member',
    USER_ALREADY_INVITED: 'Already invited',
    INVITATION_NOT_FOUND: 'Invitation not found',
    INVITATION_NOT_FOR_YOU: 'Invitation not for you',
    ONLY_ADMIN_CAN_REMOVE_MEMBERS: 'Only admin can remove',
    CANNOT_LEAVE_WITH_MEMBERS: 'Cannot leave with members',
    CREATOR_CANNOT_LEAVE_ALONE: 'Creator cannot leave',
    CANNOT_REMOVE_ADMIN_OR_OWNER: 'Cannot remove admin/owner',
    ONLY_ADMIN_OR_OWNER_CAN_UPDATE_ROLES: 'Only admin/owner can update',
    INVALID_MEMBER_ROLE: 'Invalid role',
    CANNOT_CHANGE_OWNER_ROLE: 'Cannot change owner role',
    CANNOT_CHANGE_ADMIN_ROLE: 'Cannot change admin role',
    ONLY_ADMIN_CAN_CANCEL_INVITATION: 'Only admin can cancel',
  })),
}));
jest.mock('@/utils/error', () => ({
  throwIfError: jest.fn((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  }),
}));

import {
  createOrganisation,
  getOrganisationsByUser,
  getCurrentOrganisation,
  setCurrentOrganisation,
  updateOrganisation,
  deleteOrganisation,
  inviteUserToOrganisation,
  getPendingInvitationsForUser,
  acceptInvitation,
  declineInvitation,
  moveInvitationsToMembership,
  removeUserFromOrganisation,
  getOrganisationMembers,
  updateMemberRole,
  getOrganisationPendingInvites,
  cancelInvitation,
  getOrganisationById,
} from '@/lib/organisation';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { throwIfError } from '@/utils/error';
import getMessage from '@/constants/messages';

const mockUser = { id: 'u1', email: 'user@example.com' };
const mockOrg = {
  id: 'org1',
  name: 'Test Org',
  slug: 'test-org-abc123',
  createdByUserId: 'u1',
  _count: { members: 1 },
};

beforeEach(() => {
  // Use resetAllMocks to guarantee clean state (clears all mocks including default implementations)
  jest.resetAllMocks();
  // Re-apply throwIfError implementation after reset
  (throwIfError as jest.Mock).mockImplementation((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  });
  // Re-apply getMessage mock after reset
  (getMessage as jest.Mock).mockReturnValue({
    UNAUTHORIZED_USER: 'Unauthorized',
    NOT_ORGANISATION_MEMBER: 'Not a member',
    ORGANISATION_NOT_FOUND: 'Org not found',
    ORGANISATION_ONLY_CREATOR_CAN_DELETE: 'Only creator can delete',
    ORGANISATION_CANNOT_DELETE_WITH_MEMBERS: 'Cannot delete with members',
    ONLY_ADMIN_CAN_UPDATE_ORGANISATION: 'Only admin can update',
    ORGANISATION_NOTHING_TO_UPDATE: 'Nothing to update',
    ONLY_ADMIN_CAN_INVITE: 'Only admin can invite',
    USER_ALREADY_ORGANISATION_MEMBER: 'Already a member',
    USER_ALREADY_INVITED: 'Already invited',
    INVITATION_NOT_FOUND: 'Invitation not found',
    INVITATION_NOT_FOR_YOU: 'Invitation not for you',
    ONLY_ADMIN_CAN_REMOVE_MEMBERS: 'Only admin can remove',
    CANNOT_LEAVE_WITH_MEMBERS: 'Cannot leave with members',
    CREATOR_CANNOT_LEAVE_ALONE: 'Creator cannot leave',
    CANNOT_REMOVE_ADMIN_OR_OWNER: 'Cannot remove admin/owner',
    ONLY_ADMIN_OR_OWNER_CAN_UPDATE_ROLES: 'Only admin/owner can update',
    INVALID_MEMBER_ROLE: 'Invalid role',
    CANNOT_CHANGE_OWNER_ROLE: 'Cannot change owner role',
    CANNOT_CHANGE_ADMIN_ROLE: 'Cannot change admin role',
    ONLY_ADMIN_CAN_CANCEL_INVITATION: 'Only admin can cancel',
  });
  (getCurrentUser as jest.Mock).mockResolvedValue(mockUser);
  // Default: no existing slug (unique slug generation)
  (prisma.organisation.findUnique as jest.Mock).mockResolvedValue(null);
  // Default: findUnique on organisationUser returns null (not a member by default)
  (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue(null);
  // Default: findMany returns empty arrays
  (prisma.organisationUser.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.databaseConfigUser.findMany as jest.Mock).mockResolvedValue([]);
  // Default: databaseConfig.findMany returns [] (no org configs)
  (prisma.databaseConfig.findMany as jest.Mock).mockResolvedValue([]);
  // Default: $transaction resolves
  (prisma.$transaction as jest.Mock).mockResolvedValue([]);
  // Default: user.findUnique returns null
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
  // Default: invited user operations return null/[]
  (prisma.organisationInvitedUser.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.organisationInvitedUser.findMany as jest.Mock).mockResolvedValue([]);
});

describe('createOrganisation', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(createOrganisation('My Org')).rejects.toThrow('Unauthorized');
  });

  it('creates organisation and adds creator as owner', async () => {
    (prisma.organisation.create as jest.Mock).mockResolvedValue(mockOrg);
    (prisma.organisationUser.create as jest.Mock).mockResolvedValue({});

    const result = await createOrganisation('My Org');
    expect(result).toEqual(mockOrg);
    expect(prisma.organisation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'My Org', createdByUserId: 'u1' }),
      })
    );
    expect(prisma.organisationUser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'owner' }),
      })
    );
  });

  it('throws when slug generation exhausts retries', async () => {
    // Every slug already exists
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue({ id: 'existing' });
    await expect(createOrganisation('My Org')).rejects.toThrow(
      'Unable to generate a unique organisation slug'
    );
  });
});

describe('getOrganisationsByUser', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getOrganisationsByUser()).rejects.toThrow('Unauthorized');
  });

  it('returns mapped organisations', async () => {
    (prisma.organisationUser.findMany as jest.Mock).mockResolvedValue([
      {
        organisation: {
          id: 'org1',
          name: 'Test Org',
          slug: 'test-org',
          createdByUserId: 'u1',
          _count: { members: 2 },
        },
        isCurrent: true,
      },
    ]);

    const result = await getOrganisationsByUser();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('org1');
    expect(result[0].isCurrent).toBe(true);
    expect(result[0].memberCount).toBe(2);
  });

  it('returns empty array when user has no orgs', async () => {
    (prisma.organisationUser.findMany as jest.Mock).mockResolvedValue([]);
    const result = await getOrganisationsByUser();
    expect(result).toEqual([]);
  });
});

describe('getCurrentOrganisation', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getCurrentOrganisation()).rejects.toThrow('Unauthorized');
  });

  it('returns null when no current org', async () => {
    (prisma.organisationUser.findFirst as jest.Mock).mockResolvedValue(null);
    const result = await getCurrentOrganisation();
    expect(result).toBeNull();
  });

  it('returns current org details', async () => {
    (prisma.organisationUser.findFirst as jest.Mock).mockResolvedValue({
      organisation: {
        id: 'org1',
        name: 'Test Org',
        slug: 'test-org',
        createdByUserId: 'u1',
        _count: { members: 3 },
      },
    });

    const result = await getCurrentOrganisation();
    expect(result).not.toBeNull();
    expect(result!.id).toBe('org1');
    expect(result!.memberCount).toBe(3);
    expect(result!.isCurrent).toBe(true);
  });
});

describe('setCurrentOrganisation', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(setCurrentOrganisation('org1')).rejects.toThrow('Unauthorized');
  });

  it('throws when user is not a member', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(setCurrentOrganisation('org1')).rejects.toThrow('Not a member');
  });

  it('sets current organisation via transaction', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ id: 'ou1' });
    (prisma.$transaction as jest.Mock).mockResolvedValue([{}, {}]);

    const result = await setCurrentOrganisation('org1');
    expect(result).toEqual({ success: true });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

describe('updateOrganisation', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(updateOrganisation('org1', { name: 'New Name' })).rejects.toThrow('Unauthorized');
  });

  it('throws when user is not admin/owner', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ role: 'member' });
    await expect(updateOrganisation('org1', { name: 'New Name' })).rejects.toThrow(
      'Only admin can update'
    );
  });

  it('throws when nothing to update', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ role: 'owner' });
    await expect(updateOrganisation('org1', {})).rejects.toThrow('Nothing to update');
  });

  it('updates organisation name', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ role: 'owner' });
    (prisma.organisation.update as jest.Mock).mockResolvedValue({
      id: 'org1',
      name: 'New Name',
    });

    const result = await updateOrganisation('org1', { name: 'New Name' });
    expect(result).toEqual({ id: 'org1', name: 'New Name' });
    expect(prisma.organisation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'New Name' } })
    );
  });
});

describe('deleteOrganisation', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(deleteOrganisation('org1')).rejects.toThrow('Unauthorized');
  });

  it('throws when organisation not found', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(deleteOrganisation('org1')).rejects.toThrow('Org not found');
  });

  it('throws when user is not the creator', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue({
      ...mockOrg,
      createdByUserId: 'other-user',
    });
    await expect(deleteOrganisation('org1')).rejects.toThrow('Only creator can delete');
  });

  it('throws when org has multiple members', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue({
      ...mockOrg,
      _count: { members: 3 },
    });
    await expect(deleteOrganisation('org1')).rejects.toThrow(
      'Cannot delete with members'
    );
  });

  it('deletes organisation successfully', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue(mockOrg);
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ isCurrent: false });
    (prisma.organisation.delete as jest.Mock).mockResolvedValue({});

    const result = await deleteOrganisation('org1');
    expect(result).toEqual({ success: true });
    expect(prisma.organisation.delete).toHaveBeenCalledWith({ where: { id: 'org1' } });
  });

  it('sets another org as current after deleting current org', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue(mockOrg);
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ isCurrent: true });
    (prisma.organisation.delete as jest.Mock).mockResolvedValue({});
    (prisma.organisationUser.findFirst as jest.Mock).mockResolvedValue({ id: 'ou2' });
    (prisma.organisationUser.update as jest.Mock).mockResolvedValue({});

    await deleteOrganisation('org1');
    expect(prisma.organisationUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isCurrent: true } })
    );
  });
});

describe('inviteUserToOrganisation', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(inviteUserToOrganisation('org1', 'a@b.com')).rejects.toThrow('Unauthorized');
  });

  it('throws when user is not admin/owner', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ role: 'member' });
    await expect(inviteUserToOrganisation('org1', 'a@b.com')).rejects.toThrow(
      'Only admin can invite'
    );
  });

  it('throws when email is invalid', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ role: 'owner' });
    await expect(inviteUserToOrganisation('org1', 'not-an-email')).rejects.toThrow(
      'Invalid email format'
    );
  });

  it('creates invitation for non-existing user', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ role: 'owner' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.organisationInvitedUser.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.organisationInvitedUser.create as jest.Mock).mockResolvedValue({});

    const result = await inviteUserToOrganisation('org1', 'new@example.com');
    expect(result).toEqual({ added: false, invited: true });
  });

  it('adds existing user directly as member', async () => {
    (prisma.organisationUser.findUnique as jest.Mock)
      .mockResolvedValueOnce({ role: 'owner' }) // hasAdminOrOwnerRole
      .mockResolvedValueOnce(null); // existingMembership check
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u2', email: 'existing@example.com' });
    (prisma.organisationUser.create as jest.Mock).mockResolvedValue({});

    const result = await inviteUserToOrganisation('org1', 'Existing@Example.com');
    expect(result).toEqual({ added: true, invited: false });
  });

  it('throws when user already a member', async () => {
    (prisma.organisationUser.findUnique as jest.Mock)
      .mockResolvedValueOnce({ role: 'owner' }) // hasAdminOrOwnerRole
      .mockResolvedValueOnce({ id: 'ou1' }); // existingMembership
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u2' });
    await expect(inviteUserToOrganisation('org1', 'member@example.com')).rejects.toThrow(
      'Already a member'
    );
  });

  it('throws when user already invited', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ role: 'owner' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.organisationInvitedUser.findUnique as jest.Mock).mockResolvedValue({ id: 'inv1' });
    await expect(inviteUserToOrganisation('org1', 'invited@example.com')).rejects.toThrow(
      'Already invited'
    );
  });
});

describe('getPendingInvitationsForUser', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getPendingInvitationsForUser()).rejects.toThrow('Unauthorized');
  });

  it('returns pending invitations', async () => {
    (prisma.organisationInvitedUser.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'inv1',
        organisationId: 'org1',
        invitedByUserId: 'u2',
        createdAt: new Date(),
        organisation: { name: 'Test Org' },
      },
    ]);

    const result = await getPendingInvitationsForUser();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('inv1');
    expect(result[0].organisationName).toBe('Test Org');
  });
});

describe('acceptInvitation', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(acceptInvitation('inv1')).rejects.toThrow('Unauthorized');
  });

  it('throws when invitation not found', async () => {
    (prisma.organisationInvitedUser.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(acceptInvitation('inv1')).rejects.toThrow('Invitation not found');
  });

  it('throws when invitation is not for current user', async () => {
    (prisma.organisationInvitedUser.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv1',
      email: 'other@example.com',
      organisationId: 'org1',
    });
    await expect(acceptInvitation('inv1')).rejects.toThrow('Invitation not for you');
  });

  it('accepts invitation and creates membership', async () => {
    (prisma.organisationInvitedUser.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv1',
      email: 'user@example.com',
      organisationId: 'org1',
    });
    (prisma.organisationUser.create as jest.Mock).mockResolvedValue({});
    (prisma.organisationInvitedUser.delete as jest.Mock).mockResolvedValue({});

    const result = await acceptInvitation('inv1');
    expect(result).toEqual({ success: true });
    expect(prisma.organisationUser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'member', userId: 'u1' }),
      })
    );
    expect(prisma.organisationInvitedUser.delete).toHaveBeenCalled();
  });
});

describe('declineInvitation', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(declineInvitation('inv1')).rejects.toThrow('Unauthorized');
  });

  it('throws when invitation not found', async () => {
    (prisma.organisationInvitedUser.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(declineInvitation('inv1')).rejects.toThrow('Invitation not found');
  });

  it('declines invitation and deletes it', async () => {
    (prisma.organisationInvitedUser.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv1',
      email: 'user@example.com',
      organisationId: 'org1',
    });
    (prisma.organisationInvitedUser.delete as jest.Mock).mockResolvedValue({});

    const result = await declineInvitation('inv1');
    expect(result).toEqual({ success: true });
    expect(prisma.organisationInvitedUser.delete).toHaveBeenCalledWith({
      where: { id: 'inv1' },
    });
  });
});

describe('moveInvitationsToMembership', () => {
  it('handles no invitations gracefully', async () => {
    (prisma.organisationInvitedUser.findMany as jest.Mock).mockResolvedValue([]);
    await expect(moveInvitationsToMembership('user@example.com', 'u1')).resolves.toBeUndefined();
  });

  it('creates memberships and deletes invitations', async () => {
    (prisma.organisationInvitedUser.findMany as jest.Mock).mockResolvedValue([
      { id: 'inv1', organisationId: 'org1' },
    ]);
    (prisma.organisationUser.create as jest.Mock).mockResolvedValue({});
    (prisma.organisationInvitedUser.delete as jest.Mock).mockResolvedValue({});

    await moveInvitationsToMembership('user@example.com', 'u1');
    expect(prisma.organisationUser.create).toHaveBeenCalledTimes(1);
    expect(prisma.organisationInvitedUser.delete).toHaveBeenCalledTimes(1);
  });
});

describe('removeUserFromOrganisation', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(removeUserFromOrganisation('org1', 'u2')).rejects.toThrow('Unauthorized');
  });

  it('throws when organisation not found', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(removeUserFromOrganisation('org1', 'u2')).rejects.toThrow('Org not found');
  });

  it('throws when creator tries to leave with other members', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue({
      id: 'org1',
      createdByUserId: 'u1',
    });
    (prisma.organisationUser.count as jest.Mock).mockResolvedValue(3);
    await expect(removeUserFromOrganisation('org1', 'u1')).rejects.toThrow(
      'Cannot leave with members'
    );
  });

  it('throws when creator tries to leave as sole member', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue({
      id: 'org1',
      createdByUserId: 'u1',
    });
    (prisma.organisationUser.count as jest.Mock).mockResolvedValue(1);
    await expect(removeUserFromOrganisation('org1', 'u1')).rejects.toThrow(
      'Creator cannot leave'
    );
  });

  it('removes other user when current user is admin', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue({
      id: 'org1',
      createdByUserId: 'owner-id',
    });
    (prisma.organisationUser.findUnique as jest.Mock)
      .mockResolvedValueOnce({ role: 'admin' }) // current user's role via findUnique
      .mockResolvedValueOnce({ isCurrent: false }); // membership of target user
    // getUserRoleInOrganisation calls findUnique for current user and target user
    (prisma.organisationUser.findUnique as jest.Mock)
      .mockResolvedValueOnce({ role: 'admin' }) // currentUserRole
      .mockResolvedValueOnce({ role: 'member' }) // targetUserRole
      .mockResolvedValueOnce({ isCurrent: false }); // membership check at end
    (prisma.databaseConfigUser.deleteMany as jest.Mock).mockResolvedValue({});
    (prisma.organisationUser.delete as jest.Mock).mockResolvedValue({});

    const result = await removeUserFromOrganisation('org1', 'u2');
    expect(result).toEqual({ success: true });
  });

  it('removes self (non-creator member)', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u2', email: 'member@example.com' });
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue({
      id: 'org1',
      createdByUserId: 'u1', // different from u2
    });
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ isCurrent: false });
    (prisma.databaseConfigUser.deleteMany as jest.Mock).mockResolvedValue({});
    (prisma.organisationUser.delete as jest.Mock).mockResolvedValue({});

    const result = await removeUserFromOrganisation('org1', 'u2');
    expect(result).toEqual({ success: true });
  });
});

describe('getOrganisationMembers', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getOrganisationMembers('org1')).rejects.toThrow('Unauthorized');
  });

  it('throws when user is not a member', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(getOrganisationMembers('org1')).rejects.toThrow('Not a member');
  });

  it('returns mapped members', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ id: 'ou1' });
    (prisma.organisationUser.findMany as jest.Mock).mockResolvedValue([
      {
        user: { id: 'u1', email: 'user@example.com', name: 'User', image: null },
        role: 'owner',
        createdAt: new Date(),
      },
    ]);
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue({
      id: 'org1',
      createdByUserId: 'u1',
    });

    const result = await getOrganisationMembers('org1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('u1');
    expect(result[0].isCreator).toBe(true);
  });
});

describe('updateMemberRole', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(updateMemberRole('org1', 'u2', 'admin')).rejects.toThrow('Unauthorized');
  });

  it('throws when organisation not found', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(updateMemberRole('org1', 'u2', 'admin')).rejects.toThrow('Org not found');
  });

  it('throws when invalid role provided', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue(mockOrg);
    await expect(updateMemberRole('org1', 'u2', 'superadmin')).rejects.toThrow('Invalid role');
  });

  it('throws when trying to change owner role', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue({
      ...mockOrg,
      createdByUserId: 'u2',
    });
    await expect(updateMemberRole('org1', 'u2', 'member')).rejects.toThrow(
      'Cannot change owner role'
    );
  });

  it('updates member role successfully', async () => {
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue(mockOrg);
    (prisma.organisationUser.findUnique as jest.Mock)
      .mockResolvedValueOnce({ role: 'owner' }) // currentUserRole
      .mockResolvedValueOnce({ role: 'member' }); // targetUserRole
    (prisma.organisationUser.update as jest.Mock).mockResolvedValue({});

    const result = await updateMemberRole('org1', 'u2', 'admin');
    expect(result).toEqual({ success: true });
  });
});

describe('getOrganisationPendingInvites', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getOrganisationPendingInvites('org1')).rejects.toThrow('Unauthorized');
  });

  it('throws when user is not a member', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(getOrganisationPendingInvites('org1')).rejects.toThrow('Not a member');
  });

  it('returns pending invites', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ id: 'ou1' });
    (prisma.organisationInvitedUser.findMany as jest.Mock).mockResolvedValue([
      { id: 'inv1', email: 'invited@example.com', createdAt: new Date() },
    ]);

    const result = await getOrganisationPendingInvites('org1');
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('invited@example.com');
  });
});

describe('cancelInvitation', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(cancelInvitation('inv1')).rejects.toThrow('Unauthorized');
  });

  it('throws when invitation not found', async () => {
    (prisma.organisationInvitedUser.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(cancelInvitation('inv1')).rejects.toThrow('Invitation not found');
  });

  it('throws when user is not admin/owner', async () => {
    (prisma.organisationInvitedUser.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv1',
      organisationId: 'org1',
      organisation: { id: 'org1' },
    });
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ role: 'member' });
    await expect(cancelInvitation('inv1')).rejects.toThrow('Only admin can cancel');
  });

  it('cancels invitation successfully', async () => {
    (prisma.organisationInvitedUser.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv1',
      organisationId: 'org1',
      organisation: { id: 'org1' },
    });
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ role: 'owner' });
    (prisma.organisationInvitedUser.delete as jest.Mock).mockResolvedValue({});

    const result = await cancelInvitation('inv1');
    expect(result).toEqual({ success: true });
  });
});

describe('getOrganisationById', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getOrganisationById('org1')).rejects.toThrow('Unauthorized');
  });

  it('throws when user is not a member', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(getOrganisationById('org1')).rejects.toThrow('Not a member');
  });

  it('returns null when organisation not found', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ isCurrent: true });
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await getOrganisationById('org1');
    expect(result).toBeNull();
  });

  it('returns organisation details', async () => {
    (prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({ isCurrent: true });
    (prisma.organisation.findUnique as jest.Mock).mockResolvedValue({
      id: 'org1',
      name: 'Test Org',
      slug: 'test-org',
      createdByUserId: 'u1',
      _count: { members: 2 },
    });

    const result = await getOrganisationById('org1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('org1');
    expect(result!.memberCount).toBe(2);
  });
});
