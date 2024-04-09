import { ModelDokuParams, getTopModels } from "@/lib/doku/model";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/doku";

export async function POST(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit;

	const params: ModelDokuParams = {
		timeLimit: {
			start: timeLimit.start,
			end: timeLimit.end,
		},
		top: formData.top || 3,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.TOP_MODELS
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getTopModels(params);
	return Response.json(res);
}
