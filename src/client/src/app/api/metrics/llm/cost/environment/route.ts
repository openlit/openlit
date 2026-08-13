import { withRouteAccess } from "@/lib/access/route-access";
import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getCostByEnvironment } from "@/lib/platform/llm/cost";
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
		validateMetricsRequestType.COST_BY_ENVIRONMENT
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getCostByEnvironment(params);
	return Response.json(res);
}

export const POST = withRouteAccess("metrics.read", POSTHandler, { requireDbConfig: true });
