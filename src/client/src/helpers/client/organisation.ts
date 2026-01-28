import { useRootStore } from "@/store";
import { deleteData, getData, postData } from "@/utils/api";
import asaw from "@/utils/asaw";
import { toast } from "sonner";
import { fetchDatabaseConfigList, pingActiveDatabaseConfig } from "./database-config";
import { OrganisationWithMeta } from "@/types/store/organisation";
import getMessage from "@/constants/messages";

export const fetchOrganisationList = async () => {
	useRootStore.getState().organisation.setIsLoading(true);
	const [err, data] = await asaw(
		getData({
			url: "/api/organisation",
			method: "GET",
		})
	);

	if (err) {
		useRootStore.getState().organisation.setIsLoading(false);
		return;
	}

	useRootStore.getState().organisation.setList(data || []);
};

export const fetchPendingInvitations = async () => {
	const [err, data] = await asaw(
		getData({
			url: "/api/organisation/invitation",
			method: "GET",
		})
	);

	if (!err) {
		useRootStore.getState().organisation.setPendingInvitations(data || []);
	}
};

export const changeActiveOrganisation = async (
	organisationId: string,
	successCb?: () => void
) => {
	const messages = getMessage();
	const [err, data] = await asaw(
		postData({
			url: `/api/organisation/current/${organisationId}`,
			data: {},
		})
	);

	if (err || data?.err) {
		toast.error(err || data?.err || messages.ORGANISATION_SWITCH_FAILED, {
			id: "organisation-switch",
		});
		return;
	}

	// Update the current organisation in store
	const list = useRootStore.getState().organisation.list || [];
	const newCurrent = list.find((org) => org.id === organisationId);
	if (newCurrent) {
		useRootStore.getState().organisation.setCurrent(newCurrent);
	}

	toast.success(messages.ORGANISATION_SWITCHED, {
		id: "organisation-switch",
	});

	// Refetch database configs for the new organisation
	await fetchDatabaseConfigList(() => {});
	await pingActiveDatabaseConfig();

	successCb?.();
};

export const createOrganisation = async (
	name: string,
	successCb?: (org: OrganisationWithMeta) => void
) => {
	const messages = getMessage();
	const [err, data] = await asaw(
		postData({
			url: "/api/organisation",
			data: { name },
		})
	);

	if (err || data?.err) {
		toast.error(err || data?.err || messages.ORGANISATION_CREATE_FAILED, {
			id: "organisation-create",
		});
		return null;
	}

	toast.success(messages.ORGANISATION_CREATED, {
		id: "organisation-create",
	});

	// Refetch organisation list
	await fetchOrganisationList();

	const newOrg = useRootStore
		.getState()
		.organisation.list?.find((org) => org.id === data.id);
	if (newOrg) {
		successCb?.(newOrg);
	}

	return data;
};

export const updateOrganisation = async (
	id: string,
	name: string,
	successCb?: () => void
) => {
	const messages = getMessage();
	const [err, data] = await asaw(
		getData({
			url: `/api/organisation/${id}`,
			method: "PUT",
			data: { name },
		})
	);

	if (err || data?.err) {
		toast.error(err || data?.err || messages.ORGANISATION_UPDATE_FAILED, {
			id: "organisation-update",
		});
		return;
	}

	toast.success(messages.ORGANISATION_UPDATED, {
		id: "organisation-update",
	});

	// Refetch organisation list
	await fetchOrganisationList();
	successCb?.();
};

export const deleteOrganisation = async (
	id: string,
	successCb?: () => void
) => {
	const messages = getMessage();
	const [err, data] = await asaw(
		deleteData({
			url: `/api/organisation/${id}`,
		})
	);

	if (err || data?.err) {
		toast.error(err || data?.err || messages.ORGANISATION_DELETE_FAILED, {
			id: "organisation-delete",
		});
		return;
	}

	toast.success(messages.ORGANISATION_DELETED, {
		id: "organisation-delete",
	});

	// Refetch organisation list
	await fetchOrganisationList();
	successCb?.();
};

export const inviteToOrganisation = async (
	organisationId: string,
	emails: string[],
	successCb?: () => void
) => {
	const messages = getMessage();
	const [err, data] = await asaw(
		postData({
			url: `/api/organisation/${organisationId}/invite`,
			data: { emails },
		})
	);

	if (err) {
		toast.error(err || messages.INVITATION_FAILED, {
			id: "organisation-invite",
		});
		return;
	}

	const successCount = data.filter((r: { error?: string }) => !r.error).length;
	const failCount = data.filter((r: { error?: string }) => r.error).length;

	if (failCount > 0 && successCount > 0) {
		toast.warning(`Sent ${successCount} invitations, ${failCount} failed`, {
			id: "organisation-invite",
		});
	} else if (failCount > 0) {
		toast.error(messages.INVITATION_FAILED, {
			id: "organisation-invite",
		});
	} else {
		toast.success(messages.INVITATIONS_SENT, {
			id: "organisation-invite",
		});
	}

	successCb?.();
};

export const acceptInvitation = async (
	invitationId: string,
	successCb?: () => void
) => {
	const messages = getMessage();
	const [err, data] = await asaw(
		postData({
			url: `/api/organisation/invitation/${invitationId}`,
			data: {},
		})
	);

	if (err || data?.err) {
		toast.error(err || data?.err || messages.INVITATION_ACCEPT_FAILED, {
			id: "organisation-invitation",
		});
		return;
	}

	toast.success(messages.INVITATION_ACCEPTED, {
		id: "organisation-invitation",
	});

	// Refetch organisations and invitations
	await fetchOrganisationList();
	await fetchPendingInvitations();
	successCb?.();
};

export const declineInvitation = async (
	invitationId: string,
	successCb?: () => void
) => {
	const messages = getMessage();
	const [err, data] = await asaw(
		deleteData({
			url: `/api/organisation/invitation/${invitationId}`,
		})
	);

	if (err || data?.err) {
		toast.error(err || data?.err || messages.INVITATION_DECLINE_FAILED, {
			id: "organisation-invitation",
		});
		return;
	}

	toast.success(messages.INVITATION_DECLINED, {
		id: "organisation-invitation",
	});

	// Refetch invitations
	await fetchPendingInvitations();
	successCb?.();
};

export const removeOrganisationMember = async (
	organisationId: string,
	userId: string,
	successCb?: () => void
) => {
	const messages = getMessage();
	const [err, data] = await asaw(
		deleteData({
			url: `/api/organisation/${organisationId}/members/${userId}`,
		})
	);

	if (err || data?.err) {
		toast.error(err || data?.err || messages.SOME_ERROR_OCCURRED, {
			id: "organisation-member",
		});
		return;
	}

	toast.success(messages.MEMBER_REMOVED, {
		id: "organisation-member",
	});

	successCb?.();
};

export const cancelOrganisationInvitation = async (
	invitationId: string,
	successCb?: () => void
) => {
	const messages = getMessage();
	const [err, data] = await asaw(
		deleteData({
			url: `/api/organisation/invitation/${invitationId}?cancel=true`,
		})
	);

	if (err || data?.err) {
		toast.error(err || data?.err || messages.INVITATION_CANCEL_FAILED, {
			id: "organisation-invitation-cancel",
		});
		return;
	}

	toast.success(messages.INVITATION_CANCELLED, {
		id: "organisation-invitation-cancel",
	});

	successCb?.();
};

export const updateMemberRole = async (
	organisationId: string,
	userId: string,
	role: string,
	successCb?: () => void
) => {
	const messages = getMessage();
	const [err, data] = await asaw(
		getData({
			url: `/api/organisation/${organisationId}/members/${userId}`,
			method: "PATCH",
			data: { role },
		})
	);

	if (err || data?.err) {
		toast.error(err || data?.err || messages.MEMBER_ROLE_UPDATE_FAILED, {
			id: "organisation-member-role",
		});
		return;
	}

	toast.success(messages.MEMBER_ROLE_UPDATED, {
		id: "organisation-member-role",
	});

	successCb?.();
};
