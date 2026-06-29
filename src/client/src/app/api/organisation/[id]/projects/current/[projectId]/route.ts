import { setCurrentProject } from "@/lib/organisation";
import asaw from "@/utils/asaw";

export async function POST(
	_request: Request,
	{ params }: { params: { id: string; projectId: string } }
) {
	const [err, res] = await asaw(
		setCurrentProject(params.id, params.projectId)
	);

	if (err) return Response.json(err, { status: 400 });

	return Response.json(res);
}
