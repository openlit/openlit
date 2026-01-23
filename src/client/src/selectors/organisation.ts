import { RootStore } from "@/types/store/root";

export const getOrganisationList = (state: RootStore) =>
	state.organisation.list;

export const getCurrentOrganisation = (state: RootStore) =>
	state.organisation.current;

export const getOrganisationPendingInvitations = (state: RootStore) =>
	state.organisation.pendingInvitations;

export const getOrganisationIsLoading = (state: RootStore) =>
	state.organisation.isLoading;

export const getHasOrganisations = (state: RootStore) =>
	(state.organisation.list?.length ?? 0) > 0;

export const getPendingInvitationsCount = (state: RootStore) =>
	state.organisation.pendingInvitations.length;
