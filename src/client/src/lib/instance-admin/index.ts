import prisma from "@/lib/prisma";

// The instance admin is the first account on the instance: the seeded user on a
// fresh install, otherwise the first person to register. Users are never
// deleted, so the earliest account is a stable owner for instance settings.
export async function getInstanceAdminUserId(): Promise<string | null> {
	const first = await prisma.user.findFirst({
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		select: { id: true },
	});
	return first?.id ?? null;
}

export async function isInstanceAdminUser(userId?: string | null): Promise<boolean> {
	if (!userId) return false;
	const adminUserId = await getInstanceAdminUserId();
	return adminUserId === userId;
}
