import { withRouteAccess } from "@/lib/access/route-access";
import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getMetricAttributeKeys } from "@/lib/platform/observability";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const params: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
	};
	const validation = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);
	if (!validation.success) return Response.json(validation.err, { status: 400 });

	return Response.json(await getMetricAttributeKeys(params));
}

export const POST = withRouteAccess("observability.read", POSTHandler, { requireDbConfig: true });
