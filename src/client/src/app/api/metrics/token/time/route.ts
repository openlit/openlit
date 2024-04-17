import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getTokensPerTime } from "@/lib/platform/token";
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
		validateMetricsRequestType.TOKENS_PER_TIME
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getTokensPerTime(params);
	return Response.json(res);
}
