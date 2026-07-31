import { getTraceSpanRecord } from "@/lib/platform/traces/read";
import { getEvaluationSummaryForSpanId } from "@/lib/platform/evaluation";
import { consoleLog } from "@/utils/log";

export async function GET(request: Request, context: any) {
	const { id } = context.params || {};

	if (!id)
		return Response.json("No span id provided", {
			status: 400,
		});

	const traceId = new URL(request.url).searchParams.get("traceId") || undefined;
	const environment = request.headers.get("x-openlit-environment") || undefined;
	const startedAt = Date.now();
	consoleLog("[api] span detail request", {
		spanId: id,
		traceId: traceId || null,
		urlHasTraceId: !!traceId,
	});

	const spanRes = await getTraceSpanRecord(id, { traceId, environment });
	let evalSummary = null;
	if (spanRes.record) {
		evalSummary = await Promise.race([
			getEvaluationSummaryForSpanId(id).catch(() => null),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 750)),
		]);
	}

	const res: any = { ...spanRes };
	if (evalSummary && evalSummary.runCount > 0) {
		res.evaluationSummary = evalSummary;
	}
	consoleLog("[api] span detail response", {
		spanId: id,
		traceId: traceId || null,
		found: !!spanRes.record,
		error: spanRes.err || null,
		evaluationSummary: !!res.evaluationSummary,
		elapsedMs: Date.now() - startedAt,
	});
	return Response.json(res);
}
