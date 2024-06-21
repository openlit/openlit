import { GPUMetricParams, TimeLimit } from "@/lib/platform/common";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/platform";
import { getGPUdata } from "@/lib/platform/gpu";

export async function POST(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;
	const gpu_type = formData.gpu_type;

	const params: GPUMetricParams = {
		timeLimit,
		gpu_type,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.GENERATION_BY_ENDPOINT
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getGPUdata(params);
	return Response.json(res);
}
