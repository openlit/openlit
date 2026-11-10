import prisma from "@/lib/prisma";
import { isInstanceAdminUser } from "@/lib/instance-admin";

/**
 * CE fallback for who may change a model endpoint. One edit redirects every
 * user's traffic on the database configuration, so this needs more than the
 * no-op route checks: the instance admin, or an owner or admin of the current
 * organisation. Enterprise replaces this neutral module through its path aliases.
 */
export async function canConfigureModelEndpoint(userId: string): Promise<boolean> {
	if (await isInstanceAdminUser(userId)) return true;

	const membership = await prisma.organisationUser.findFirst({
		where: { userId, isCurrent: true },
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
