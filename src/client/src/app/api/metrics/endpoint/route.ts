import { MetricParams, TimeLimit } from "@/lib/platform/common";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/platform";
import { getResultGenerationByEndpoint } from "@/lib/platform/endpoint";

export async function POST(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;

	const params: MetricParams = {
		timeLimit,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.GENERATION_BY_ENDPOINT
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getResultGenerationByEndpoint(params);
	return Response.json(res);
}
