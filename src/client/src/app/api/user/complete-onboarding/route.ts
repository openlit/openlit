import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";

export async function POST() {
	const [err, user] = await asaw(getCurrentUser());

	if (err || !user) {
		return Response.json("Unauthorized", {
			status: 401,
		});
	}

	await prisma.user.update({
		where: { id: user.id },
		data: { hasCompletedOnboarding: true },
	});

	return Response.json({ success: true });
}
