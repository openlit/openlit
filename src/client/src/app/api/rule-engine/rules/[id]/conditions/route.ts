import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { SERVER_EVENTS } from "@/constants/events";
import { RuleConditionGroupInput } from "@/types/rule-engine";
import { addConditionGroupsToRule } from "@/lib/platform/rule-engine";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";

async function POSTHandler(request: Request, context: any) {
	const startTimestamp = Date.now();
	const { id } = context.params;
	const formData = await request.json();

	const conditionGroups: RuleConditionGroupInput[] = formData.condition_groups || [];

	const [err, res]: any = await asaw(addConditionGroupsToRule(id, conditionGroups));
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_CONDITIONS_UPDATE_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.RULE_CONDITIONS_UPDATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

export const POST = withAudit(withCurrentOrganisationPermission("rule_engine:configure", POSTHandler));
