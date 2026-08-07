import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getMetricsFilterConfig } from "@/lib/platform/metrics/read";
import { withRouteAccess } from "@/lib/access/route-access";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { getRequestEnvironment } from "@/constants/openlit-context";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const params: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		environment: typeof formData.environment === "string" ? formData.environment : getRequestEnvironment(request),
	};
	const validation = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);
	if (!validation.success) return Response.json(validation.err, { status: 400 });

	return Response.json(await getMetricsFilterConfig(params));
}

export const POST = withRouteAccess("observability.read", POSTHandler, { requireDbConfig: true });
