import prisma from "@/lib/prisma";
import { isInstanceAdminUser } from "@/lib/instance-admin";
import { hasAdminOrOwnerRole } from "@/lib/organisation-roles";

/**
 * CE fallback for who may change a model endpoint. One edit redirects every
 * user's traffic on the database configuration, so this needs more than the
 * no-op route checks: the instance admin, or someone who can edit that
 * database configuration and may manage the organisation it belongs to, by
 * the same rule CE uses for other organisation settings. That organisation is
 * the configuration's own, not the caller's current one, so owning some other
 * organisation grants nothing. Enterprise replaces this neutral module
 * through its path aliases.
 */
export async function canConfigureModelEndpoint(
	userId: string,
	databaseConfigId: string
): Promise<boolean> {
	if (await isInstanceAdminUser(userId)) return true;

	const access = await prisma.databaseConfigUser.findUnique({
		where: { databaseConfigId_userId: { databaseConfigId, userId } },
		select: {
			canEdit: true,
			databaseConfig: {
				select: { project: { select: { organisationId: true } } },
			},
		},
	});
	const organisationId = access?.databaseConfig?.project?.organisationId;
	if (!access?.canEdit || !organisationId) return false;

	return hasAdminOrOwnerRole(organisationId, userId, "organisation.update");
}
