import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getGroupedRequests } from "@/lib/platform/request";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

export async function POST(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;
	const selectedConfig = formData.selectedConfig || {};
	const groupBy = formData.groupBy as string;

	if (!groupBy) {
		return Response.json({ err: "groupBy is required" }, { status: 400 });
	}

	const params: MetricParams = {
		timeLimit,
		selectedConfig,
		statusCode: ["STATUS_CODE_ERROR", "Error"],
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, { status: 400 });

	const res = await getGroupedRequests(params, groupBy);
	return Response.json(res);
}
