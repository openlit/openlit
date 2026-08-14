import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { SERVER_EVENTS } from "@/constants/events";
import { autoEvaluate } from "@/lib/platform/evaluation";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";

async function POSTHandler(request: NextRequest) {
	const startTimestamp = Date.now();
	const formData = await request.json();
	const result = await autoEvaluate(formData);
	PostHogServer.fireEvent({
		event: result.success
			? SERVER_EVENTS.EVALUATION_AUTO_SUCCESS
			: SERVER_EVENTS.EVALUATION_AUTO_FAILURE,
		startTimestamp,
	});
	return Response.json(result);
}

export const POST = withAudit(withCurrentOrganisationPermission("evaluation:run", POSTHandler));
