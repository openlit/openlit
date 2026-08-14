import { withRouteAccess } from "@/lib/access/route-access";
import { getRequestExist } from "@/lib/platform/request";

async function POSTHandler() {
	const res = await getRequestExist();
	const { data } = res;
	if ((data as any[])?.[0]?.total_requests > 0) {
		return Response.json(true);
	}

	return Response.json(false);
}

export const POST = withRouteAccess("metrics.read", POSTHandler, { requireDbConfig: true });
