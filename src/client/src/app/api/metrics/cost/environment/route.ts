import { DokuParams } from "@/lib/doku/common";
import { getCostByEnvironment } from "@/lib/doku/cost";
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
		validateMetricsRequestType.COST_BY_ENVIRONMENT
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getCostByEnvironment(params);
	return Response.json(res);
}
