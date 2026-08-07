import { getTraceExist } from "@/lib/platform/traces/read";
import { withRouteAccess } from "@/lib/access/route-access";

async function POSTHandler() {
	const res = await getTraceExist();
	const { data } = res;
	if ((data as any[])?.[0]?.total_requests > 0) {
		return Response.json(true);
	}

	return Response.json(false);
}

export const POST = withRouteAccess("traces.read", POSTHandler, { requireDbConfig: true });
