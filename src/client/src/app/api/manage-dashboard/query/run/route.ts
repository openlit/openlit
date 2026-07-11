import { SERVER_EVENTS } from "@/constants/events";
import getMessage from "@/constants/messages";
import { getCurrentUser } from "@/lib/session";
import { runWidgetQuery } from "@/lib/platform/manage-dashboard/widget";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const messages = getMessage();
	let body: {
		widgetId?: string;
		userQuery?: string;
		filter?: unknown;
		sourceId?: string | null;
		signal?: string;
		structuredQuery?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return Response.json(
			{ err: messages.MANAGE_MODELS_INVALID_JSON },
			{ status: 400 }
		);
	}

	const { widgetId, userQuery, filter, sourceId, signal, structuredQuery } = body;
	if (!widgetId || typeof widgetId !== "string") {
		return Response.json(
			{ err: messages.WIDGET_FETCH_FAILED },
			{ status: 400 }
		);
	}

	const startTimestamp = Date.now();
	const res = await runWidgetQuery(widgetId, {
		userQuery,
		filter: filter as Parameters<typeof runWidgetQuery>[1]["filter"],
		sourceId,
		signal: signal as Parameters<typeof runWidgetQuery>[1]["signal"],
		structuredQuery: structuredQuery as Parameters<
			typeof runWidgetQuery
		>[1]["structuredQuery"],
	});
	PostHogServer.fireEvent({
		event: res.err
			? SERVER_EVENTS.DASHBOARD_QUERY_RUN_FAILURE
			: SERVER_EVENTS.DASHBOARD_QUERY_RUN_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}
