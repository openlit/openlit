import { getHeirarchyViaSpanId } from "@/lib/platform/request";
import { resolveDbConfigId } from "@/helpers/server/auth";

export async function GET(request: Request, context: any) {
	const [authErr, databaseConfigId] = await resolveDbConfigId(request);
	if (authErr) {
		return Response.json({ err: authErr }, { status: 401 });
	}

	const { id } = context.params || {};

	if (!id) {
		return Response.json("No span id provided", {
			status: 400,
		});
	}

	const res: any = await getHeirarchyViaSpanId(id, databaseConfigId);
	return Response.json(res);
}
