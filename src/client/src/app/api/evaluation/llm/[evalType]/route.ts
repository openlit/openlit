import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getEvaluationDetectedByType } from "@/lib/platform/evaluation";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ evalType: string }> }
) {
	const { evalType } = await params;
	const startTimestamp = Date.now();
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;

	const metricParams: MetricParams = {
		timeLimit,
		selectedConfig: formData.selectedConfig,
	};

	const validationParam = validateMetricsRequest(
		metricParams,
		validateMetricsRequestType.GET_TOTAL_EVALUATION_DETECTED
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getEvaluationDetectedByType(metricParams, evalType);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.EVALUATION_LLM_RUN_FAILURE : SERVER_EVENTS.EVALUATION_LLM_RUN_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}
