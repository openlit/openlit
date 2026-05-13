import { getDBConfigByUser } from "@/lib/db-config";
import {
	getTraceImprovement,
	streamTraceImprovementAnalysis,
} from "@/lib/platform/chat/improvement";
import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";

async function getDatabaseConfigId() {
	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	return (dbConfig as any)?.id || "";
}

function logRoute(stage: string, payload: Record<string, unknown>) {
	const line = `[trace-analysis-route] ${stage} ${JSON.stringify({
		time: new Date().toISOString(),
		...payload,
	})}`;
	console.log(line);
}

function getScope(request: Request) {
	const scope = new URL(request.url).searchParams.get("scope");
	return scope === "span" ? "span" : "trace";
}

export async function GET(request: Request, context: any) {
	const user = await getCurrentUser();
	if (!user) {
		logRoute("get_unauthorized", {});
		return Response.json("Unauthorized", { status: 401 });
	}

	const { spanId } = context.params || {};
	if (!spanId) {
		logRoute("get_missing_span", {});
		return Response.json("No span id provided", { status: 400 });
	}

	const databaseConfigId = await getDatabaseConfigId();
	const scope = getScope(request);
	logRoute("get_start", { spanId, scope, databaseConfigId });
	const { data, err } = await getTraceImprovement(spanId, databaseConfigId, scope);
	if (err) {
		logRoute("get_failed", { spanId, scope, err });
		return Response.json(err, { status: 400 });
	}
	logRoute("get_done", {
		spanId,
		scope,
		rootSpanId: data?.rootSpanId,
		runCount: data?.runs?.length || 0,
	});

	return Response.json({ data: data || null });
}

export async function POST(request: Request, context: any) {
	const user = await getCurrentUser();
	if (!user) {
		logRoute("post_unauthorized", {});
		return Response.json("Unauthorized", { status: 401 });
	}

	const { spanId } = context.params || {};
	if (!spanId) {
		logRoute("post_missing_span", {});
		return Response.json("No span id provided", { status: 400 });
	}

	const databaseConfigId = await getDatabaseConfigId();
	const scope = getScope(request);
	logRoute("post_start", { spanId, scope, databaseConfigId });
	const { response, err } = await streamTraceImprovementAnalysis(
		spanId,
		databaseConfigId,
		scope
	);
	if (err) {
		logRoute("post_failed", { spanId, scope, err });
		return Response.json(err, { status: 400 });
	}
	if (!response) {
		logRoute("post_empty_response", { spanId, scope });
		return Response.json("Failed to run AI improvement analysis", {
			status: 400,
		});
	}
	logRoute("post_stream_returned", { spanId, scope });

	return response;
}
