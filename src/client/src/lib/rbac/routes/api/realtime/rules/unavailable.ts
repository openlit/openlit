import getMessage from "@/constants/messages";

export function realtimeRulesUnavailable() {
	return Response.json({ error: getMessage().REALTIME_RULES_UNAVAILABLE }, { status: 402 });
}
