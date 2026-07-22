import { getRequestViaTraceId } from "@/lib/platform/request";
import { resolveDbConfigId } from "@/helpers/server/auth";

export async function GET(request: Request, context: any) {
	const [authErr, databaseConfigId] = await resolveDbConfigId(request);
	if (authErr) {
		return Response.json({ err: authErr }, { status: 401 });
	}

	const { id } = (await context.params) || {};

	if (!id)
		return Response.json("No parent span id provided", {
			status: 400,
		});

	const res: any = await getRequestViaTraceId(id, databaseConfigId);
	return Response.json(res);
}
