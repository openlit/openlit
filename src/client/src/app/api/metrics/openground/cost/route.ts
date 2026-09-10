import { withRouteAccess } from "@/lib/access/route-access";
import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getOpengroundCostAnalytics } from "@/lib/platform/openground/cost-analytics";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

async function POSTHandler(request: Request) {
	let formData: Record<string, unknown>;
	try {
		formData = await request.json();
	} catch {
		return Response.json("Invalid JSON body", { status: 400 });
	}

	const timeLimit = formData.timeLimit as TimeLimit;
	const params: MetricParams = {
		timeLimit,
		selectedConfig: formData.selectedConfig,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.OPENGROUND_COST_ANALYTICS
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res = await getOpengroundCostAnalytics(params);
	return Response.json(res);
}

export const POST = withRouteAccess("metrics.read", POSTHandler, {
	requireDbConfig: true,
});
