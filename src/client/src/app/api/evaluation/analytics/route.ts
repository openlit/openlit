import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getEvaluationAnalytics } from "@/lib/platform/evaluation/analytics";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
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
		validateMetricsRequestType.GET_EVALUATION_ANALYTICS
	);

	if (!validationParam.success) {
		return Response.json(validationParam.err, {
			status: 400,
		});
	}

	const res = await getEvaluationAnalytics(params);
	return Response.json(res);
}
