import { withRouteAccess } from "@/lib/access/route-access";
import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getAgentLoop } from "@/lib/platform/llm/agent-loop";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { getRequestEnvironment } from "@/constants/openlit-context";
import getMessage from "@/constants/messages";

async function POSTHandler(request: Request) {
	let formData: Record<string, unknown>;
	try {
		formData = await request.json();
	} catch {
		return Response.json(getMessage().TELEMETRY_SOURCE_INVALID_JSON, {
			status: 400,
		});
	}

	const timeLimit = formData.timeLimit as TimeLimit;
	const params: MetricParams = {
		timeLimit,
		selectedConfig: formData.selectedConfig,
		...(typeof formData.sourceId === "string" ? { sourceId: formData.sourceId } : {}),
		environment:
			typeof formData.environment === "string"
				? formData.environment
				: getRequestEnvironment(request),
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.AGENT_LOOP
	);

	if (!validationParam.success) {
		return Response.json(validationParam.err, {
			status: 400,
		});
	}

	const res = await getAgentLoop(params);
	return Response.json(res);
}

export const POST = withRouteAccess("metrics.read", POSTHandler, {
	requireDbConfig: true,
});
