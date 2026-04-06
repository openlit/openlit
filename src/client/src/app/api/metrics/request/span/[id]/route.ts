import { getRequestViaSpanId } from "@/lib/platform/request";
import { getEvaluationSummaryForSpanId } from "@/lib/platform/evaluation";

export async function GET(_: Request, context: any) {
	const { id } = context.params || {};

	if (!id)
		return Response.json("No span id provided", {
			status: 400,
		});

	const [spanRes, evalSummary] = await Promise.all([
		getRequestViaSpanId(id),
		getEvaluationSummaryForSpanId(id),
	]);

	const res: any = { ...spanRes };
	if (evalSummary && evalSummary.runCount > 0) {
		res.evaluationSummary = evalSummary;
	}
	return Response.json(res);
}
