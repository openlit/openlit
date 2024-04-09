import { DokuParams } from "@/lib/doku/common";
import { getTokensPerTime } from "@/lib/doku/token";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/doku";

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
		validateMetricsRequestType.TOKENS_PER_TIME
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getTokensPerTime(params);
	return Response.json(res);
}
