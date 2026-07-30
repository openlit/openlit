import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getTraceAttributeKeys } from "@/lib/platform/traces/read";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { getRequestEnvironment } from "@/constants/openlit-context";

export async function POST(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;

	const params: MetricParams = {
		timeLimit,
		selectedConfig: formData.selectedConfig,
		environment: typeof formData.environment === "string" ? formData.environment : getRequestEnvironment(request),
		...(typeof formData.sourceId === "string"
			? { sourceId: formData.sourceId }
			: {}),
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res = await getTraceAttributeKeys(params);
	return Response.json(res);
}
