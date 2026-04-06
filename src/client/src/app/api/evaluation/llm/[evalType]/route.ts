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
	{ params: { evalType } }: { params: { evalType: string } }
) {
	const startTimestamp = Date.now();
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;

	const params: MetricParams = {
		timeLimit,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_TOTAL_EVALUATION_DETECTED
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getEvaluationDetectedByType(params, evalType);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.EVALUATION_LLM_RUN_FAILURE : SERVER_EVENTS.EVALUATION_LLM_RUN_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}
