import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { withRouteAccess } from "@/lib/access/route-access";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { listTraceRecords } from "@/lib/platform/traces/read";
import { getRequestEnvironment } from "@/constants/openlit-context";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;
	const limit = formData.limit || 10;
	const offset = formData.offset || 0;
	const selectedConfig = formData.selectedConfig || {};
	const sorting = formData.sorting || {};

	const params: MetricParams = {
		timeLimit,
		limit,
		offset,
		selectedConfig,
		sorting,
		statusCode: ["STATUS_CODE_ERROR", "Error", "ERROR"],
		environment: typeof formData.environment === "string" ? formData.environment : getRequestEnvironment(request),
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	try {
		const res: any = await listTraceRecords(params);
		return Response.json(res);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return Response.json(
			{ err: message, code: "TELEMETRY_SOURCE_UNAVAILABLE" },
			{ status: 503 }
		);
	}

}

export const POST = withRouteAccess("traces.read", POSTHandler, { requireDbConfig: true });
