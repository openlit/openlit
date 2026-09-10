import { getTraceHierarchy } from "@/lib/platform/traces/read";
import { withRouteAccess } from "@/lib/access/route-access";
import { getRequestEnvironment } from "@/constants/openlit-context";

async function GETHandler(request: Request, context: any) {
	const { id } = context.params || {};

	if (!id) {
		return Response.json("No span id provided", {
			status: 400,
		});
	}

	const url = new URL(request.url);
	const traceId = url.searchParams.get("traceId") || undefined;
	const environment =
		url.searchParams.get("environment") || getRequestEnvironment(request);
	const res: any = await getTraceHierarchy(id, { traceId, environment });
	return Response.json(res);
}

export const GET = withRouteAccess("traces.read", GETHandler, {
	requireDbConfig: true,
});
