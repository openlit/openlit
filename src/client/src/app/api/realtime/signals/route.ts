import { NextRequest } from "next/server";
import getMessage from "@/constants/messages";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";
import { withRouteAccess } from "@/lib/access/route-access";
import { getCurrentUser } from "@/lib/session";
import { LiveSignalError, listLiveSignals } from "@/lib/platform/realtime/signals";

export const dynamic = "force-dynamic";

async function GETHandler(request: NextRequest) {
	const messages = getMessage();
	const user = await getCurrentUser();
	if (!user) return Response.json({ error: messages.UNAUTHORIZED_USER }, { status: 401 });

	const params = request.nextUrl.searchParams;
	const environment =
		params.get("environment") ||
		request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) ||
		"production";

	try {
		const result = await listLiveSignals({
			environment,
			limit: Number(params.get("limit")) || undefined,
		});
		return Response.json(result);
	} catch (error) {
		if (error instanceof LiveSignalError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		console.error("[realtime] failed to list signals", error);
		return Response.json({ error: messages.REALTIME_SIGNALS_FETCH_FAILED }, { status: 500 });
	}
}

export const GET = withRouteAccess("realtime.read", GETHandler);
