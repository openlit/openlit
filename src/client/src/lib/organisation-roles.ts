import prisma from "@/lib/prisma";
import {
	OrganisationAccessAction,
	canManageOrganisation,
} from "@/features/organisation-access";

/**
 * Whether a user may perform an organisation-level action: the enterprise
 * extension hook decides when it returns a value, otherwise CE's built-in
 * owner and admin roles do. This is the one place CE spells that rule out.
 */
export async function hasAdminOrOwnerRole(
	organisationId: string,
	userId: string,
	action: OrganisationAccessAction
): Promise<boolean> {
	const extensionDecision = await canManageOrganisation({
		organisationId,
		userId,
		action,
	});
	if (typeof extensionDecision === "boolean") return extensionDecision;

	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId,
				userId,
			},
		},
		select: { role: true },
	});

	if (!membership) return false;

	// Owner or admin have elevated permissions
	return membership.role === "owner" || membership.role === "admin";
}
