import { getTraceRecordByTraceId } from "@/lib/platform/traces/read";
import { withRouteAccess } from "@/lib/access/route-access";

async function GETHandler(request: Request, context: any) {
	const { id } = context.params || {};

	if (!id)
		return Response.json("No parent span id provided", {
			status: 400,
		});

	const environment = request.headers.get("x-openlit-environment") || undefined;
	const res: any = await getTraceRecordByTraceId(id, environment);
	return Response.json(res);
}

export const GET = withRouteAccess("traces.read", GETHandler, { requireDbConfig: true });
