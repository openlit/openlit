/**
 * @deprecated Prefer POST /api/telemetry/metrics — kept for API compatibility.
 */
import { withRouteAccess } from "@/lib/access/route-access";
import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { listMetricRecords } from "@/lib/platform/metrics/read";
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
		limit: formData.limit || 25,
		offset: formData.offset || 0,
		selectedConfig: formData.selectedConfig || {},
		sorting: formData.sorting || {},
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
		return jsonWithObservabilityDeprecation(validation.err, "/api/telemetry/metrics", {
			status: 400,
		});
	}

	try {
		return jsonWithObservabilityDeprecation(
			await listMetricRecords(params),
			"/api/telemetry/metrics"
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return jsonWithObservabilityDeprecation(
			{ err: message, code: "TELEMETRY_SOURCE_UNAVAILABLE" },
			"/api/telemetry/metrics",
			{ status: 503 }
		);
	}
}

export const POST = withRouteAccess("observability.read", POSTHandler, {
	requireDbConfig: true,
});
