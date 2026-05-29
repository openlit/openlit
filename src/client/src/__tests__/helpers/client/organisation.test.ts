jest.mock('@/store', () => ({
  useRootStore: {
    getState: jest.fn(),
  },
}));
jest.mock('@/utils/api', () => ({
  getData: jest.fn(),
  postData: jest.fn(),
  deleteData: jest.fn(),
}));
jest.mock('@/utils/asaw', () => jest.fn());
jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));
jest.mock('posthog-js', () => ({
  capture: jest.fn(),
  default: { capture: jest.fn() },
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    ORGANISATION_SWITCH_FAILED: 'Switch failed',
    ORGANISATION_SWITCHED: 'Switched!',
    ORGANISATION_CREATE_FAILED: 'Create failed',
    ORGANISATION_CREATED: 'Created!',
    ORGANISATION_UPDATE_FAILED: 'Update failed',
    ORGANISATION_UPDATED: 'Updated!',
    ORGANISATION_DELETE_FAILED: 'Delete failed',
    ORGANISATION_DELETED: 'Deleted!',
    INVITATION_FAILED: 'Invite failed',
    INVITATIONS_SENT: 'Invitations sent!',
    INVITATIONS_PARTIAL_SUCCESS: '{success} sent, {fail} failed',
    INVITATION_ACCEPTED: 'Invitation accepted!',
    INVITATION_ACCEPT_FAILED: 'Accept failed',
    INVITATION_DECLINED: 'Invitation declined!',
    INVITATION_DECLINE_FAILED: 'Decline failed',
    INVITATION_CANCEL_FAILED: 'Cancel failed',
    INVITATION_CANCELLED: 'Invitation cancelled!',
    MEMBER_REMOVED: 'Member removed!',
    MEMBER_ROLE_UPDATED: 'Role updated!',
    MEMBER_ROLE_UPDATE_FAILED: 'Role update failed',
    SOME_ERROR_OCCURRED: 'Error occurred',
  })),
}));
jest.mock('@/helpers/client/database-config', () => ({
  fetchDatabaseConfigList: jest.fn().mockResolvedValue(undefined),
  pingActiveDatabaseConfig: jest.fn().mockResolvedValue(undefined),
}));

import {
  fetchOrganisationList,
  fetchPendingInvitations,
  changeActiveOrganisation,
  createOrganisation,
  updateOrganisation,
  deleteOrganisation,
  inviteToOrganisation,
  acceptInvitation,
  declineInvitation,
  removeOrganisationMember,
  cancelOrganisationInvitation,
  updateMemberRole,
} from '@/helpers/client/organisation';
import { useRootStore } from '@/store';
import { getData, postData, deleteData } from '@/utils/api';
import asaw from '@/utils/asaw';
import { toast } from 'sonner';

const mockSetIsLoading = jest.fn();
const mockSetList = jest.fn();
const mockSetCurrent = jest.fn();
const mockSetPendingInvitations = jest.fn();

const makeGetState = (list: any[] = []) => ({
  organisation: {
    setIsLoading: mockSetIsLoading,
    setList: mockSetList,
    setCurrent: mockSetCurrent,
    setPendingInvitations: mockSetPendingInvitations,
    list,
  },
  databaseConfig: {
    setIsLoading: jest.fn(),
    setList: jest.fn(),
    setPing: jest.fn(),
    list: [],
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  (useRootStore.getState as jest.Mock).mockReturnValue(makeGetState());
});

describe('fetchOrganisationList', () => {
  it('sets loading, fetches list, and updates store', async () => {
    const orgList = [{ id: 'org-1', name: 'Test Org' }];
    (asaw as jest.Mock).mockResolvedValue([null, orgList]);

    await fetchOrganisationList();

    expect(mockSetIsLoading).toHaveBeenCalledWith(true);
    expect(getData).toHaveBeenCalledWith({ url: '/api/organisation', method: 'GET' });
    expect(mockSetList).toHaveBeenCalledWith(orgList);
  });

  it('stops loading and returns on error', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Network error', null]);

    await fetchOrganisationList();

    expect(mockSetIsLoading).toHaveBeenCalledWith(false);
    expect(mockSetList).not.toHaveBeenCalled();
  });
});

describe('fetchPendingInvitations', () => {
  it('fetches and sets pending invitations', async () => {
    const invitations = [{ id: 'inv-1' }];
    (asaw as jest.Mock).mockResolvedValue([null, invitations]);

    await fetchPendingInvitations();

    expect(getData).toHaveBeenCalledWith({ url: '/api/organisation/invitation', method: 'GET' });
    expect(mockSetPendingInvitations).toHaveBeenCalledWith(invitations);
  });

  it('does not set invitations on error', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Error', null]);
    await fetchPendingInvitations();
    expect(mockSetPendingInvitations).not.toHaveBeenCalled();
  });
});

describe('changeActiveOrganisation', () => {
  it('updates current org and shows success toast', async () => {
    const orgList = [{ id: 'org-1', isCurrent: false }, { id: 'org-2', isCurrent: true }];
    (useRootStore.getState as jest.Mock).mockReturnValue(makeGetState(orgList));
    (asaw as jest.Mock).mockResolvedValue([null, {}]);
    const successCb = jest.fn();

    await changeActiveOrganisation('org-1', successCb);

    expect(mockSetCurrent).toHaveBeenCalledWith(orgList[0]);
    expect(toast.success).toHaveBeenCalled();
    expect(successCb).toHaveBeenCalled();
  });

  it('shows error toast and returns early on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Failed', null]);
    const successCb = jest.fn();

    await changeActiveOrganisation('org-1', successCb);

    expect(toast.error).toHaveBeenCalled();
    expect(successCb).not.toHaveBeenCalled();
  });

  it('shows error toast when data.err is set', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, { err: 'Permission denied' }]);
    await changeActiveOrganisation('org-1');
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('createOrganisation', () => {
  it('creates org and calls successCb', async () => {
    const newOrg = { id: 'org-new', name: 'New Org' };
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, newOrg]) // createOrganisation
      .mockResolvedValueOnce([null, [newOrg]]); // fetchOrganisationList
    (useRootStore.getState as jest.Mock).mockReturnValue(
      makeGetState([newOrg])
    );
    const successCb = jest.fn();

    await createOrganisation('New Org', successCb);

    expect(postData).toHaveBeenCalledWith({ url: '/api/organisation', data: { name: 'New Org' } });
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows error toast on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Create error', null]);
    const result = await createOrganisation('Test');
    expect(toast.error).toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

describe('updateOrganisation', () => {
  it('calls API and shows success toast', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, {}]) // update
      .mockResolvedValueOnce([null, []]); // fetchOrganisationList
    const successCb = jest.fn();

    await updateOrganisation('org-1', 'Updated Name', successCb);

    expect(getData).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/organisation/org-1', method: 'PUT' })
    );
    expect(toast.success).toHaveBeenCalled();
    expect(successCb).toHaveBeenCalled();
  });

  it('shows error toast on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Error', null]);
    await updateOrganisation('org-1', 'Name');
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('deleteOrganisation', () => {
  it('calls delete API and shows success toast', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, {}]) // delete
      .mockResolvedValueOnce([null, []]); // fetchOrganisationList
    const successCb = jest.fn();

    await deleteOrganisation('org-1', successCb);

    expect(deleteData).toHaveBeenCalledWith({ url: '/api/organisation/org-1' });
    expect(toast.success).toHaveBeenCalled();
    expect(successCb).toHaveBeenCalled();
  });

  it('shows error toast on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Error', null]);
    await deleteOrganisation('org-1');
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('inviteToOrganisation', () => {
  it('shows success toast when all invitations succeed', async () => {
    const results = [{ email: 'a@b.com', result: 'ok' }];
    (asaw as jest.Mock).mockResolvedValue([null, results]);
    const successCb = jest.fn();

    await inviteToOrganisation('org-1', ['a@b.com'], successCb);

    expect(toast.success).toHaveBeenCalled();
    expect(successCb).toHaveBeenCalled();
  });

  it('shows error toast when all invitations fail', async () => {
    const results = [{ email: 'a@b.com', error: 'User not found' }];
    (asaw as jest.Mock).mockResolvedValue([null, results]);
    const successCb = jest.fn();

    await inviteToOrganisation('org-1', ['a@b.com'], successCb);

    expect(toast.error).toHaveBeenCalled();
    expect(successCb).not.toHaveBeenCalled();
  });

  it('shows warning toast for partial success', async () => {
    const results = [
      { email: 'a@b.com', result: 'ok' },
      { email: 'c@d.com', error: 'Not found' },
    ];
    (asaw as jest.Mock).mockResolvedValue([null, results]);
    const successCb = jest.fn();

    await inviteToOrganisation('org-1', ['a@b.com', 'c@d.com'], successCb);

    expect(toast.warning).toHaveBeenCalled();
    expect(successCb).toHaveBeenCalled();
  });

  it('shows error toast on network error', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Network error', null]);
    await inviteToOrganisation('org-1', ['a@b.com']);
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('acceptInvitation', () => {
  it('accepts invitation and calls successCb', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, {}]) // accept
      .mockResolvedValueOnce([null, []]) // fetchOrganisationList
      .mockResolvedValueOnce([null, []]); // fetchPendingInvitations
    const successCb = jest.fn();

    await acceptInvitation('inv-1', successCb);

    expect(postData).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/organisation/invitation/inv-1' })
    );
    expect(toast.success).toHaveBeenCalled();
    expect(successCb).toHaveBeenCalled();
  });

  it('shows error toast on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Error', null]);
    await acceptInvitation('inv-1');
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('declineInvitation', () => {
  it('declines invitation and calls successCb', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, {}]) // decline
      .mockResolvedValueOnce([null, []]); // fetchPendingInvitations
    const successCb = jest.fn();

    await declineInvitation('inv-1', successCb);

    expect(deleteData).toHaveBeenCalledWith({ url: '/api/organisation/invitation/inv-1' });
    expect(toast.success).toHaveBeenCalled();
    expect(successCb).toHaveBeenCalled();
  });

  it('shows error toast on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Error', null]);
    await declineInvitation('inv-1');
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('removeOrganisationMember', () => {
  it('removes member and calls successCb', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, {}]);
    const successCb = jest.fn();

    await removeOrganisationMember('org-1', 'user-1', successCb);

    expect(deleteData).toHaveBeenCalledWith({
      url: '/api/organisation/org-1/members/user-1',
    });
    expect(toast.success).toHaveBeenCalled();
    expect(successCb).toHaveBeenCalled();
  });

  it('shows error toast on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Error', null]);
    await removeOrganisationMember('org-1', 'user-1');
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('cancelOrganisationInvitation', () => {
  it('cancels invitation and calls successCb', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, {}]);
    const successCb = jest.fn();

    await cancelOrganisationInvitation('inv-1', successCb);

    expect(deleteData).toHaveBeenCalledWith({
      url: '/api/organisation/invitation/inv-1?cancel=true',
    });
    expect(toast.success).toHaveBeenCalled();
    expect(successCb).toHaveBeenCalled();
  });

  it('shows error toast on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Error', null]);
    await cancelOrganisationInvitation('inv-1');
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('updateMemberRole', () => {
  it('updates role and calls successCb', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, {}]);
    const successCb = jest.fn();

    await updateMemberRole('org-1', 'user-1', 'admin', successCb);

    expect(getData).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/organisation/org-1/members/user-1', method: 'PATCH' })
    );
    expect(toast.success).toHaveBeenCalled();
    expect(successCb).toHaveBeenCalled();
  });

  it('shows error toast on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Error', null]);
    await updateMemberRole('org-1', 'user-1', 'admin');
    expect(toast.error).toHaveBeenCalled();
  });
});
