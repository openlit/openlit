import { getTraceRecordByTraceId } from "@/lib/platform/traces/read";
import { withRouteAccess } from "@/lib/access/route-access";
import { getRequestEnvironment } from "@/constants/openlit-context";

async function GETHandler(request: Request, context: any) {
	const { id } = context.params || {};

	if (!id)
		return Response.json("No parent span id provided", {
			status: 400,
		});

	const environment =
		new URL(request.url).searchParams.get("environment") ||
		getRequestEnvironment(request);
	const res: any = await getTraceRecordByTraceId(id, environment);
	return Response.json(res);
}

export const GET = withRouteAccess("traces.read", GETHandler, {
	requireDbConfig: true,
});
