import { requireRouteAccess } from "@/lib/access/route-access";
import { runWidgetQuery } from "@/lib/platform/manage-dashboard/widget";
import asaw from "@/utils/asaw";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const [permissionErr] = await asaw(
		requireRouteAccess("dashboard.read")
	);
	if (permissionErr) {
		return Response.json({ err: String(permissionErr) }, { status: 403 });
	}

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
