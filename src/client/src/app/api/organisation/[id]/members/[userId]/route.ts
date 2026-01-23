import { removeUserFromOrganisation } from "@/lib/organisation";
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
