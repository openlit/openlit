import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getMetrics } from "@/lib/platform/observability";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

export async function POST(request: Request) {
	const formData = await request.json();
	const params: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		limit: formData.limit || 25,
		offset: formData.offset || 0,
		selectedConfig: formData.selectedConfig || {},
		sorting: formData.sorting || {},
	};
	const validation = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);
	if (!validation.success) return Response.json(validation.err, { status: 400 });

	return Response.json(await getMetrics(params));
}
