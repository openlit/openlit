/**
 * @deprecated Prefer POST /api/telemetry/metrics/config — kept for API compatibility.
 */
import { withRouteAccess } from "@/lib/access/route-access";
import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getMetricsFilterConfig } from "@/lib/platform/metrics/read";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { getRequestEnvironment } from "@/constants/openlit-context";
import { jsonWithObservabilityDeprecation } from "@/lib/platform/observability-deprecation";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const params: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		environment:
			typeof formData.environment === "string"
				? formData.environment
				: getRequestEnvironment(request),
	};
	const validation = validateMetricsRequest(
		params,
		validateMetricsRequestType.GET_ALL
	);
	if (!validation.success) {
		return jsonWithObservabilityDeprecation(
			validation.err,
			"/api/telemetry/metrics/config",
			{ status: 400 }
		);
	}

	try {
		return jsonWithObservabilityDeprecation(
			await getMetricsFilterConfig(params),
			"/api/telemetry/metrics/config"
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return jsonWithObservabilityDeprecation(
			{ err: message, code: "TELEMETRY_SOURCE_UNAVAILABLE" },
			"/api/telemetry/metrics/config",
			{ status: 503 }
		);
	}
}

export const POST = withRouteAccess("observability.read", POSTHandler, {
	requireDbConfig: true,
});
