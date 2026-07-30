import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getMetricAttributeKeysRecord } from "@/lib/platform/metrics/read";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { getRequestEnvironment } from "@/constants/openlit-context";

export async function POST(request: Request) {
	const formData = await request.json();
	const params: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		environment: typeof formData.environment === "string" ? formData.environment : getRequestEnvironment(request),
	};
	const validation = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);
	if (!validation.success) return Response.json(validation.err, { status: 400 });

	return Response.json(await getMetricAttributeKeysRecord(params));
}
