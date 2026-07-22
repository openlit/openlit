import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getEvaluationEvaluatorAnalytics } from "@/lib/platform/evaluation/analytics";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest, props: { params: Promise<{ evaluatorId: string }> }) {
    const params = await props.params;
    let formData: Record<string, unknown>;
    try {
		formData = await request.json();
	} catch {
		return Response.json("Invalid JSON body", { status: 400 });
	}

    const evaluatorId = decodeURIComponent(params.evaluatorId || "").trim();
    if (!evaluatorId) {
		return Response.json("Evaluator id missing!", { status: 400 });
	}

    const timeLimit = formData.timeLimit as TimeLimit;
    const metricParams: MetricParams = {
		timeLimit,
		selectedConfig: formData.selectedConfig,
	};

    const validationParam = validateMetricsRequest(
		metricParams,
		validateMetricsRequestType.GET_EVALUATION_ANALYTICS
	);

    if (!validationParam.success) {
		return Response.json(validationParam.err, {
			status: 400,
		});
	}

    const res = await getEvaluationEvaluatorAnalytics(metricParams, evaluatorId);
    if (res.configured && !res.found) {
		return Response.json(res, { status: 404 });
	}
    return Response.json(res);
}
