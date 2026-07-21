import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getPricingCronAnalytics } from "@/lib/platform/pricing/cron-analytics";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

export async function POST(request: Request) {
	let formData: Record<string, unknown>;
	try {
		formData = await request.json();
	} catch {
		return Response.json("Invalid JSON body", { status: 400 });
	}

	const timeLimit = formData.timeLimit as TimeLimit;
	const params: MetricParams = {
		timeLimit,
		selectedConfig: formData.selectedConfig,
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.TOTAL_COST
	);

	if (!validationParam.success) {
		return Response.json(validationParam.err, { status: 400 });
	}

	const limit =
		typeof formData.limit === "number" ? formData.limit : undefined;
	const res = await getPricingCronAnalytics(params, { limit });
	return Response.json(res);
}
