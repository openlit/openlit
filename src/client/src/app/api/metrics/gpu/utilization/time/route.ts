import { withRouteAccess } from "@/lib/access/route-access";
import { GPUMetricParams, TimeLimit } from "@/lib/platform/common";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { getUtilizationParamsPerTime } from "@/lib/platform/gpu/utilization";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;

	const params: GPUMetricParams = {
		timeLimit,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.UTILIZATION_PER_TIME
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getUtilizationParamsPerTime(params);
	return Response.json(res);
}

export const POST = withRouteAccess("metrics.read", POSTHandler, { requireDbConfig: true });
