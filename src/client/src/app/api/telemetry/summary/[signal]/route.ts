import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getSignalSummary } from "@/lib/platform/observability";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { resolveDbConfigId } from "@/helpers/server/auth";

const VALID_SIGNALS = new Set(["traces", "exceptions", "logs", "metrics"]);

export async function POST(request: Request, props: { params: Promise<{ signal: string }> }) {
    const params = await props.params;
    const [authErr, databaseConfigId] = await resolveDbConfigId(request);
    if (authErr) {
		return Response.json({ err: authErr }, { status: 401 });
	}

    if (!VALID_SIGNALS.has(params.signal)) {
		return Response.json({ err: "Invalid signal" }, { status: 400 });
	}

    const formData = await request.json();
    const metricParams: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		selectedConfig: formData.selectedConfig || {},
		databaseConfigId,
	};

    const validation = validateMetricsRequest(
		metricParams,
		validateMetricsRequestType.GET_ALL
	);
    if (!validation.success) return Response.json(validation.err, { status: 400 });

    return Response.json(
		await getSignalSummary(
			metricParams,
			params.signal as "traces" | "exceptions" | "logs" | "metrics"
		)
	);
}
