import { SERVER_EVENTS } from "@/constants/events";
import { getDBConfigByUser } from "@/lib/db-config";
import {
	getTraceImprovement,
	streamTraceImprovementAnalysis,
} from "@/lib/platform/chat/improvement";
import { getCurrentUser } from "@/lib/session";
import PostHogServer from "@/lib/posthog";
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
	const startTimestamp = Date.now();
	const user = await getCurrentUser();
	if (!user) {
		logRoute("get_unauthorized", {});
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.AI_ANALYSIS_GET_FAILURE,
			startTimestamp,
			properties: { reason: "unauthorized" },
		});
		return Response.json("Unauthorized", { status: 401 });
	}

	const { spanId } = context.params || {};
	if (!spanId) {
		logRoute("get_missing_span", {});
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.AI_ANALYSIS_GET_FAILURE,
			startTimestamp,
			properties: { reason: "missing_span" },
		});
		return Response.json("No span id provided", { status: 400 });
	}

	const databaseConfigId = await getDatabaseConfigId();
	const scope = getScope(request);
	logRoute("get_start", { spanId, scope, databaseConfigId });
	const { data, err } = await getTraceImprovement(spanId, databaseConfigId, scope);
	if (err) {
		logRoute("get_failed", { spanId, scope, err });
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.AI_ANALYSIS_GET_FAILURE,
			startTimestamp,
			properties: { spanId, scope, databaseConfigId, error: err },
		});
		return Response.json(err, { status: 400 });
	}
	logRoute("get_done", {
		spanId,
		scope,
		rootSpanId: data?.rootSpanId,
		runCount: data?.runs?.length || 0,
	});
	PostHogServer.fireEvent({
		event: SERVER_EVENTS.AI_ANALYSIS_GET_SUCCESS,
		startTimestamp,
		properties: {
			spanId,
			scope,
			databaseConfigId,
			rootSpanId: data?.rootSpanId,
			runCount: data?.runs?.length || 0,
		},
	});

	return Response.json({ data: data || null });
}

export async function POST(request: Request, context: any) {
	const startTimestamp = Date.now();
	const user = await getCurrentUser();
	if (!user) {
		logRoute("post_unauthorized", {});
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.AI_ANALYSIS_RUN_FAILURE,
			startTimestamp,
			properties: { reason: "unauthorized" },
		});
		return Response.json("Unauthorized", { status: 401 });
	}

	const { spanId } = context.params || {};
	if (!spanId) {
		logRoute("post_missing_span", {});
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.AI_ANALYSIS_RUN_FAILURE,
			startTimestamp,
			properties: { reason: "missing_span" },
		});
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
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.AI_ANALYSIS_RUN_FAILURE,
			startTimestamp,
			properties: { spanId, scope, databaseConfigId, error: err },
		});
		return Response.json(err, { status: 400 });
	}
	if (!response) {
		logRoute("post_empty_response", { spanId, scope });
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.AI_ANALYSIS_RUN_FAILURE,
			startTimestamp,
			properties: { spanId, scope, databaseConfigId, reason: "empty_response" },
		});
		return Response.json("Failed to run AI improvement analysis", {
			status: 400,
		});
	}
	logRoute("post_stream_returned", { spanId, scope });
	PostHogServer.fireEvent({
		event: SERVER_EVENTS.AI_ANALYSIS_RUN_SUCCESS,
		startTimestamp,
		properties: { spanId, scope, databaseConfigId },
	});

	return response;
}
