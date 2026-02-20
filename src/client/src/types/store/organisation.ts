export type OrganisationWithMeta = {
	id: string;
	name: string;
	slug: string;
	isCurrent: boolean;
	memberCount: number;
	createdByUserId: string;
};

export type OrganisationInvitation = {
	id: string;
	organisationId: string;
	organisationName: string;
	invitedByUserId: string;
	createdAt: string;
};

export type OrganisationStore = {
	list?: OrganisationWithMeta[];
	current?: OrganisationWithMeta;
	pendingInvitations: OrganisationInvitation[];
	isLoading: boolean;
	setList: (list: OrganisationWithMeta[]) => void;
	setCurrent: (org?: OrganisationWithMeta) => void;
	setPendingInvitations: (invites: OrganisationInvitation[]) => void;
	setIsLoading: (loading: boolean) => void;
	reset: () => void;
};
