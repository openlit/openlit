import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getRequestPerTime } from "@/lib/platform/request";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

export async function POST(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;

	const params: MetricParams = {
		timeLimit,
		selectedConfig: formData.selectedConfig,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.REQUEST_PER_TIME
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getRequestPerTime(params);
	return Response.json(res);
}
