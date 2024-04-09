import { DokuParams } from "@/lib/doku/common";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/doku";
import { getResultGenerationByEndpoint } from "@/lib/doku/endpoint";

export async function POST(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit;

	const params: DokuParams = {
		timeLimit: {
			start: timeLimit.start,
			end: timeLimit.end,
		},
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
