import { getPrompts } from "@/lib/platform/prompt";
import { errorResponse } from "@/helpers/server/response";
import { resolveDbConfigId } from "@/helpers/server/auth";

export async function POST(request: Request) {
	const [authErr, databaseConfigId] = await resolveDbConfigId(request);
	if (authErr) {
		return Response.json({ err: authErr }, { status: 401 });
	}

	const { err, data }: any = await getPrompts({ databaseConfigId });
	if (err) {
		return errorResponse(err);
	}

	return Response.json(data);
}
