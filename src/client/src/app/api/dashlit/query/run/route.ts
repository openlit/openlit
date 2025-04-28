import { runWidgetQuery } from "@/lib/platform/dashlit/widget";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const {
		widgetId,
		userQuery,
		respectFilters = false,
		params,
	} = await request.json();

	const res = await runWidgetQuery(widgetId, {
		userQuery,
		respectFilters,
		params,
	});
	return Response.json(res);
}
