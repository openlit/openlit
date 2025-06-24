import { runWidgetQuery } from "@/lib/platform/manage-dashboard/widget";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const {
		widgetId,
		userQuery,
		filter,
	} = await request.json();

	const res = await runWidgetQuery(widgetId, {
		userQuery,
		filter,
	});
	return Response.json(res);
}
