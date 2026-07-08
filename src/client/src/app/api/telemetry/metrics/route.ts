import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getMetrics } from "@/lib/platform/observability";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { resolveDbConfigId } from "@/helpers/server/auth";

export async function POST(request: Request) {
	const [authErr, databaseConfigId] = await resolveDbConfigId(request);
	if (authErr) {
		return Response.json({ err: authErr }, { status: 401 });
	}

	const formData = await request.json();
	const params: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		limit: formData.limit || 25,
		offset: formData.offset || 0,
		selectedConfig: formData.selectedConfig || {},
		sorting: formData.sorting || {},
		databaseConfigId,
	};
	const validation = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);
	if (!validation.success) return Response.json(validation.err, { status: 400 });

	return Response.json(await getMetrics(params));
}
