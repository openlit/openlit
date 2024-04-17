import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getResultGenerationByCategories } from "@/lib/platform/category";
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
		validateMetricsRequestType.GENERATION_BY_CATEGORY
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getResultGenerationByCategories(params);
	return Response.json(res);
}
