import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getTraceGrouped } from "@/lib/platform/traces/read";
import { withRouteAccess } from "@/lib/access/route-access";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { GroupByKey } from "@/types/store/filter";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;
	const selectedConfig = formData.selectedConfig || {};
	const groupBy = formData.groupBy as GroupByKey;

	if (!groupBy) {
		return Response.json({ err: "groupBy is required" }, { status: 400 });
	}

	const params: MetricParams = {
		timeLimit,
		selectedConfig,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, { status: 400 });

	const res = await getTraceGrouped(params, groupBy);
	return Response.json(res);
}

export const POST = withRouteAccess("traces.read", POSTHandler, { requireDbConfig: true });
