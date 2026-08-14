import {
	getOrganisationMembers,
	getOrganisationPendingInvites,
} from "@/lib/organisation";
import { withPermission } from "@/lib/rbac/route";
import asaw from "@/utils/asaw";

async function GETHandler(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;

	const [membersErr, members] = await asaw(getOrganisationMembers(id));
	if (membersErr)
		return Response.json(membersErr, {
			status: 400,
		});

	const [invitesErr, pendingInvites] = await asaw(
		getOrganisationPendingInvites(id)
	);
	if (invitesErr)
		return Response.json(invitesErr, {
			status: 400,
		});

	return Response.json({
		members,
		pendingInvites,
	});
}

export const GET = withPermission("members:read", GETHandler);
