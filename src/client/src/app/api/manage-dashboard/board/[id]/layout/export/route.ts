import { SERVER_EVENTS } from "@/constants/events";
import { getBoardLayout } from "@/lib/platform/manage-dashboard/board";
import { toExportDashboardPayload } from "@/lib/platform/manage-dashboard/board-format";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";

// Export board layout
export async function GET(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const startTimestamp = Date.now();
	const res = await getBoardLayout(id);
	PostHogServer.fireEvent({
		event: res.err
			? SERVER_EVENTS.DASHBOARD_LAYOUT_EXPORT_FAILURE
			: SERVER_EVENTS.DASHBOARD_LAYOUT_EXPORT_SUCCESS,
		startTimestamp,
	});
	if (res.err) {
		return new Response(JSON.stringify({ error: res.err }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}
	const payload = toExportDashboardPayload(
		res.data as unknown as Record<string, unknown>
	);
	const json = JSON.stringify(payload, null, 2);
	const title =
		typeof payload.title === "string" && payload.title
			? payload.title
			: id;
	return new Response(json, {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Content-Disposition": `attachment; filename=openlit-dashboard-${title}-layout.json`,
		},
	});
}
