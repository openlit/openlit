import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getTraceSummary } from "@/lib/platform/traces/read";
import { getLogsSummary } from "@/lib/platform/logs/read";
import { getMetricsSummary } from "@/lib/platform/metrics/read";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

const VALID_SIGNALS = new Set(["traces", "exceptions", "logs", "metrics"]);

/** Route each signal's summary through its per-signal read facade. */
function summaryForSignal(signal: string, params: MetricParams) {
	if (signal === "logs") return getLogsSummary(params);
	if (signal === "metrics") return getMetricsSummary(params);
	return getTraceSummary(params, signal as "traces" | "exceptions");
}

export async function POST(
	request: Request,
	{ params }: { params: { signal: string } }
) {
	if (!VALID_SIGNALS.has(params.signal)) {
		return Response.json({ err: "Invalid signal" }, { status: 400 });
	}

	const formData = await request.json();
	const metricParams: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		selectedConfig: formData.selectedConfig || {},
	};

	const validation = validateMetricsRequest(
		metricParams,
		validateMetricsRequestType.GET_ALL
	);
	if (!validation.success) return Response.json(validation.err, { status: 400 });

	return Response.json(await summaryForSignal(params.signal, metricParams));
}
