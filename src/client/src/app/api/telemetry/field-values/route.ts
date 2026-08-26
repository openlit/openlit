import { getRequestEnvironment } from "@/constants/openlit-context";
import type { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getSignalFieldValues } from "@/lib/platform/connectors/datasource/field-values";
import type { Signal } from "@/lib/platform/connectors/datasource/types";
import { withRouteAccess } from "@/lib/access/route-access";

type TelemetrySignal = Exclude<Signal, "intelligence">;
const SIGNALS = new Set<TelemetrySignal>(["traces", "logs", "metrics"]);
const SAFE_FIELD = /^[A-Za-z0-9_.:-]{1,256}$/;

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const signal = formData.signal as TelemetrySignal;
	const field = typeof formData.field === "string" ? formData.field.trim() : "";

	if (!SIGNALS.has(signal) || !SAFE_FIELD.test(field)) {
		return Response.json({ values: [] }, { status: 400 });
	}

	const params: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		selectedConfig: formData.selectedConfig || {},
		...(typeof formData.sourceId === "string"
			? { sourceId: formData.sourceId }
			: {}),
		environment:
			typeof formData.environment === "string"
				? formData.environment
				: getRequestEnvironment(request),
	};

	const result = await getSignalFieldValues(signal, field, params);
	return Response.json(result, { status: result.err ? 503 : 200 });
}

export const POST = withRouteAccess("observability.read", POSTHandler, { requireDbConfig: true });
