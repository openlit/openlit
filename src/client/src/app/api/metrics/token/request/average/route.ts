import { type TokenParams, getAverageTokensPerRequest } from "@/lib/doku/token";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/utils/doku";

export async function POST(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit;

	const params: TokenParams = {
		timeLimit: {
			start: timeLimit.start,
			end: timeLimit.end,
		},
		type: formData.type,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.AVERAGE_REQUEST_TOKEN
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getAverageTokensPerRequest(params);
	return Response.json(res);
}
