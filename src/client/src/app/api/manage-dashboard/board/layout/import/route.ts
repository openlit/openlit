import { SERVER_EVENTS } from "@/constants/events";
import getMessage from "@/constants/messages";
import { importBoardLayout } from "@/lib/platform/manage-dashboard/board";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const startTimestamp = Date.now();
	let data: unknown;
	try {
		data = await request.json();
	} catch {
		return new Response(
			JSON.stringify({ error: getMessage().BOARD_IMPORT_INVALID_JSON }),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	const { err, data: boardData } = await importBoardLayout(data);
	PostHogServer.fireEvent({
		event: err
			? SERVER_EVENTS.DASHBOARD_IMPORT_FAILURE
			: SERVER_EVENTS.DASHBOARD_IMPORT_SUCCESS,
		startTimestamp,
	});

	if (err) {
		return new Response(JSON.stringify({ error: err }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	return new Response(JSON.stringify({ data: boardData }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
