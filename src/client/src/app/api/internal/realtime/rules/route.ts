import { NextRequest } from "next/server";
import getMessage from "@/constants/messages";
import { isValidCronJobRequest } from "@/helpers/server/cron-auth";
import { getActiveRealtimeRules } from "@/lib/platform/realtime/rules";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
	if (!isValidCronJobRequest(request)) {
		return Response.json({ error: getMessage().FORBIDDEN_ACTION }, { status: 403 });
	}
	const rules = await getActiveRealtimeRules();
	return Response.json({ rules });
}
