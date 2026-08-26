import { getTraceSpanRecord } from "@/lib/platform/traces/read";
import { getEvaluationSummaryForSpanId } from "@/lib/platform/evaluation";
import { withRouteAccess } from "@/lib/access/route-access";
import { getRequestEnvironment } from "@/constants/openlit-context";

async function GETHandler(request: Request, context: any) {
	const { id } = context.params || {};

	if (!id)
		return Response.json("No span id provided", {
			status: 400,
		});

	const url = new URL(request.url);
	const traceId = url.searchParams.get("traceId") || undefined;
	const environment =
		url.searchParams.get("environment") || getRequestEnvironment(request);

	const [spanRes, evalSummary] = await Promise.all([
		getTraceSpanRecord(id, { traceId, environment }),
		getEvaluationSummaryForSpanId(id),
	]);

	const res: any = { ...spanRes };
	if (evalSummary && evalSummary.runCount > 0) {
		res.evaluationSummary = evalSummary;
	}
	return Response.json(res);
}

export const GET = withRouteAccess("traces.read", GETHandler, {
	requireDbConfig: true,
});
