import { getRequestViaSpanId } from "@/lib/platform/request";
import { getEvaluationSummaryForSpanId } from "@/lib/platform/evaluation";
import { resolveDbConfigId } from "@/helpers/server/auth";

export async function GET(request: Request, context: any) {
	const [authErr, databaseConfigId] = await resolveDbConfigId(request);
	if (authErr) {
		return Response.json({ err: authErr }, { status: 401 });
	}

	const { id } = context.params || {};

	if (!id)
		return Response.json("No span id provided", {
			status: 400,
		});

	const [spanRes, evalSummary] = await Promise.all([
		getRequestViaSpanId(id, databaseConfigId),
		getEvaluationSummaryForSpanId(id, databaseConfigId),
	]);

	const res: any = { ...spanRes };
	if (evalSummary && evalSummary.runCount > 0) {
		res.evaluationSummary = evalSummary;
	}
	return Response.json(res);
}
