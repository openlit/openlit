/**
 * @deprecated Prefer POST /api/telemetry/metrics/[name] — kept for API compatibility.
 */
import { withRouteAccess } from "@/lib/access/route-access";
import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getMetricDetailRecord } from "@/lib/platform/metrics/read";
import { getRequestEnvironment } from "@/constants/openlit-context";
import { jsonWithObservabilityDeprecation } from "@/lib/platform/observability-deprecation";

async function POSTHandler(
	request: Request,
	{ params }: { params: { name: string } }
) {
	const formData = await request.json();
	const metricName = decodeURIComponent(params.name);
	const metricType = formData.metricType as string | undefined;
	const serviceName = formData.serviceName as string | undefined;
	const metricParams: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		selectedConfig: formData.selectedConfig || {},
		environment:
			typeof formData.environment === "string"
				? formData.environment
				: getRequestEnvironment(request),
	};

	try {
		return jsonWithObservabilityDeprecation(
			await getMetricDetailRecord(
				metricName,
				metricType,
				serviceName,
				metricParams
			),
			`/api/telemetry/metrics/${encodeURIComponent(metricName)}`
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return jsonWithObservabilityDeprecation(
			{ err: message, code: "TELEMETRY_SOURCE_UNAVAILABLE" },
			`/api/telemetry/metrics/${encodeURIComponent(metricName)}`,
			{ status: 503 }
		);
	}
}

export const POST = withRouteAccess("observability.read", POSTHandler, {
	requireDbConfig: true,
});
