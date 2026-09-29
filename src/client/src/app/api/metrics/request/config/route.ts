import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getTraceFilterConfig } from "@/lib/platform/traces/read";
import { withRouteAccess } from "@/lib/access/route-access";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { getRequestEnvironment } from "@/constants/openlit-context";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;
	const limit = formData.limit || 10;
	const offset = formData.offset || 0;

	const params: MetricParams = {
		timeLimit,
		limit,
		offset,
		selectedConfig: formData.selectedConfig,
		statusCode: formData.statusCode,
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

	const res: any = await getTraceFilterConfig(params);
	return Response.json(res);
}

export const POST = withRouteAccess("traces.read", POSTHandler, { requireDbConfig: true });
