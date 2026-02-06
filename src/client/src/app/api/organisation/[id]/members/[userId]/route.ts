import { removeUserFromOrganisation, updateMemberRole } from "@/lib/organisation";
import asaw from "@/utils/asaw";

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string; userId: string }> }
) {
	const { id, userId } = await params;

	const [err, res] = await asaw(removeUserFromOrganisation(id, userId));

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string; userId: string }> }
) {
	const { id, userId } = await params;
	const body = await request.json();
	const { role } = body;

	if (!role) {
		return Response.json({ error: "Role is required" }, { status: 400 });
	}

	const [err, res] = await asaw(updateMemberRole(id, userId, role));

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}
