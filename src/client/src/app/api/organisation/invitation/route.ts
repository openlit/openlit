import { getPendingInvitationsForUser } from "@/lib/organisation";
import asaw from "@/utils/asaw";

export async function GET() {
	const [err, res] = await asaw(getPendingInvitationsForUser());
	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}
