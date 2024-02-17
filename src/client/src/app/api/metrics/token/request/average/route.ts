import { DokuParams } from "@/lib/doku/common";
import { getAverageTokensPerRequest } from "@/lib/doku/token";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/utils/doku";

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
		validateMetricsRequestType.AVERAGE_REQUEST_COST
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getAverageTokensPerRequest(params);
	return Response.json(res);
}
