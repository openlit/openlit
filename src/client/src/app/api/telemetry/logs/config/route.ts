import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getLogsConfig } from "@/lib/platform/logs/read";
import { withRouteAccess } from "@/lib/access/route-access";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { getRequestEnvironment } from "@/constants/openlit-context";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const params: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		environment:
			typeof formData.environment === "string"
				? formData.environment
				: getRequestEnvironment(request),
		...(typeof formData.sourceId === "string"
			? { sourceId: formData.sourceId }
			: {}),
	};
	const validation = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);
	if (!validation.success) return Response.json(validation.err, { status: 400 });

	try {
		return Response.json(await getLogsConfig(params));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return Response.json(
			{ err: message, code: "TELEMETRY_SOURCE_UNAVAILABLE" },
			{ status: 503 }
		);
	}
}

export const POST = withRouteAccess("logs.read", POSTHandler, {
	requireDbConfig: true,
});
