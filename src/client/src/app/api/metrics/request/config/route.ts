import { withRouteAccess } from "@/lib/access/route-access";
import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getRequestsConfig } from "@/lib/platform/request";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;
	const limit = formData.limit || 10;
	const offset = formData.offset || 0;

	const params: MetricParams = {
		timeLimit,
		limit,
		offset,
		selectedConfig: formData.selectedConfig,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getRequestsConfig(params);
	return Response.json(res);
}

export const POST = withRouteAccess("metrics.read", POSTHandler, { requireDbConfig: true });
