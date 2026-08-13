import { getTraceRecordByTraceId } from "@/lib/platform/traces/read";
import { withRouteAccess } from "@/lib/access/route-access";

async function GETHandler(_: Request, context: any) {
	const { id } = context.params || {};

	if (!id)
		return Response.json("No parent span id provided", {
			status: 400,
		});

	const res: any = await getTraceRecordByTraceId(id);
	return Response.json(res);
}

export const GET = withRouteAccess("traces.read", GETHandler, { requireDbConfig: true });
