export type OrganisationAccessAction =
	| "organisation:update"
	| "members:invite"
	| "members:remove"
	| "members:role_change";

type OrganisationAccessContext = {
	organisationId: string;
	userId: string;
	action: OrganisationAccessAction;
};

export async function canManageOrganisation(
	_context: OrganisationAccessContext
): Promise<boolean | undefined> {
	return undefined;
}
