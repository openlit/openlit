import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getTraceSummary } from "@/lib/platform/traces/read";
import { getLogsSummary } from "@/lib/platform/logs/read";
import { getMetricsSummary } from "@/lib/platform/metrics/read";
import {
	requireRouteAccess,
	withRouteAccess,
	type RouteAccessKey,
} from "@/lib/access/route-access";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import asaw from "@/utils/asaw";
import { getRequestEnvironment } from "@/constants/openlit-context";
import { jsonWithObservabilityDeprecation } from "@/lib/platform/observability-deprecation";

const VALID_SIGNALS = new Set(["traces", "exceptions", "logs", "metrics"]);
const SIGNAL_ACCESS: Record<string, RouteAccessKey> = {
	traces: "traces.read",
	exceptions: "traces.read",
	logs: "logs.read",
	metrics: "metrics.read",
};

/** Route each signal's summary through its per-signal read facade. */
function summaryForSignal(signal: string, params: MetricParams) {
	if (signal === "logs") return getLogsSummary(params);
	if (signal === "metrics") return getMetricsSummary(params);
	return getTraceSummary(params, signal as "traces" | "exceptions");
}

/**
 * @deprecated Prefer POST /api/telemetry/summary/[signal] — kept for API compatibility.
 */
async function POSTHandler(
	request: Request,
	{ params }: { params: { signal: string } }
) {
	if (!VALID_SIGNALS.has(params.signal)) {
		return jsonWithObservabilityDeprecation(
			{ err: "Invalid signal" },
			`/api/telemetry/summary/${params.signal}`,
			{ status: 400 }
		);
	}
	const [permissionErr] = await asaw(
		requireRouteAccess(SIGNAL_ACCESS[params.signal])
	);
	if (permissionErr) {
		return jsonWithObservabilityDeprecation(
			{ err: String(permissionErr) },
			`/api/telemetry/summary/${params.signal}`,
			{ status: 403 }
		);
	}

	const formData = await request.json();
	const metricParams: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		selectedConfig: formData.selectedConfig || {},
		...(typeof formData.sourceId === "string" ? { sourceId: formData.sourceId } : {}),
		environment:
			typeof formData.environment === "string"
				? formData.environment
				: getRequestEnvironment(request),
	};

	const validation = validateMetricsRequest(
		metricParams,
		validateMetricsRequestType.GET_ALL
	);
	if (!validation.success) {
		return jsonWithObservabilityDeprecation(
			validation.err,
			`/api/telemetry/summary/${params.signal}`,
			{ status: 400 }
		);
	}

	try {
		return jsonWithObservabilityDeprecation(
			await summaryForSignal(params.signal, metricParams),
			`/api/telemetry/summary/${params.signal}`
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return jsonWithObservabilityDeprecation(
			{ err: message, code: "TELEMETRY_SOURCE_UNAVAILABLE" },
			`/api/telemetry/summary/${params.signal}`,
			{ status: 503 }
		);
	}
}

export const POST = withRouteAccess("observability.read", POSTHandler, {
	requireDbConfig: true,
});
