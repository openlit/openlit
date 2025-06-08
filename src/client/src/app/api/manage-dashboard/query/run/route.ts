import { runWidgetQuery } from "@/lib/platform/manage-dashboard/widget";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const {
		widgetId,
		userQuery,
		respectFilters = false,
		filter,
	} = await request.json();

	const res = await runWidgetQuery(widgetId, {
		userQuery,
		respectFilters,
		filter,
	});
	return Response.json(res);
}
