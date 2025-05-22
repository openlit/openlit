import { getMainDashboard } from "@/lib/platform/manage-dashboard/board";
import { NextRequest } from "next/server";

export async function GET(_: NextRequest) {
	const res = await getMainDashboard();
	return Response.json(res);
}
