import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getTraceAverageDuration } from "@/lib/platform/traces/read";
import { withRouteAccess } from "@/lib/access/route-access";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { OPERATION_TYPE } from "@/types/platform";
import { getRequestEnvironment } from "@/constants/openlit-context";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;
	const operationType = formData.operationType as OPERATION_TYPE;

	const params: MetricParams = {
		timeLimit,
		operationType,
		selectedConfig: formData.selectedConfig,
		environment:
			typeof formData.environment === "string"
				? formData.environment
				: getRequestEnvironment(request),
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.AVERAGE_REQUEST_DURATION
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getTraceAverageDuration(params);
	return Response.json(res);
}

export const POST = withRouteAccess("traces.read", POSTHandler, {
	requireDbConfig: true,
});
