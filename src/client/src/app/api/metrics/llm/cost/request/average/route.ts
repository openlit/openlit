import { withRouteAccess } from "@/lib/access/route-access";
import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getAverageCost } from "@/lib/platform/llm/cost";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;

	const params: MetricParams = {
		timeLimit,
		selectedConfig: formData.selectedConfig,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.AVERAGE_REQUEST_COST
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getAverageCost(params);
	return Response.json(res);
}

export const POST = withRouteAccess("metrics.read", POSTHandler, { requireDbConfig: true });
