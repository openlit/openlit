import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getCostByProvider } from "@/lib/platform/llm/cost";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

export async function POST(request: Request) {
	let formData: Record<string, unknown>;
	try {
		formData = await request.json();
	} catch {
		return Response.json("Invalid JSON body", { status: 400 });
	}

	const timeLimit = formData.timeLimit as TimeLimit;
	const params: MetricParams = {
		timeLimit,
		selectedConfig: formData.selectedConfig,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.COST_BY_PROVIDER
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res = await getCostByProvider(params);
	return Response.json(res);
}
