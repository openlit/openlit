import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getTotalRequests } from "@/lib/platform/request";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/platform";

export async function POST(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;

	const params: MetricParams = {
		timeLimit,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.TOTAL_REQUESTS
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getTotalRequests(params);
	return Response.json(res);
}
