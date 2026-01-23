import { setCurrentOrganisation } from "@/lib/organisation";
import asaw from "@/utils/asaw";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;

	const [err, res] = await asaw(setCurrentOrganisation(id));

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}
