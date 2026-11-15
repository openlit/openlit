import prisma from "@/lib/prisma";
import { isInstanceAdminUser } from "@/lib/instance-admin";

/**
 * CE fallback for who may change a model endpoint. One edit redirects every
 * user's traffic on the database configuration, so this needs more than the
 * no-op route checks: the instance admin, or someone who can edit that
 * database configuration and is an owner or admin of the organisation it
 * belongs to. The role is checked in the configuration's own organisation,
 * not the caller's current one, so owning some other organisation grants
 * nothing. Enterprise replaces this neutral module through its path aliases.
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

	const membership = await prisma.organisationUser.findUnique({
		where: { organisationId_userId: { organisationId, userId } },
		select: {
			role: true,
			organisation: { select: { createdByUserId: true } },
		},
	});
	if (!membership) return false;

	return (
		membership.role === "owner" ||
		membership.role === "admin" ||
		membership.organisation.createdByUserId === userId
	);
}
