import { SERVER_EVENTS } from "@/constants/events";
import { RuleInput } from "@/types/rule-engine";
import { getRules, createRule } from "@/lib/platform/rule-engine";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";
import { resolveRuleEngineDatabaseConfigId } from "@/lib/platform/rule-engine/source";

export async function GET(request: Request) {
	const startTimestamp = Date.now();
	const databaseConfigId = await resolveRuleEngineDatabaseConfigId(request);
	const { err, data }: any = await getRules(databaseConfigId);
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_LIST_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.RULE_LIST_SUCCESS,
		startTimestamp,
	});
	return Response.json(data);
}

export async function POST(request: Request) {
	const startTimestamp = Date.now();
	const formData = await request.json();
	const databaseConfigId = await resolveRuleEngineDatabaseConfigId(request);

	const ruleInput: Partial<RuleInput> = {
		name: formData.name,
		description: formData.description,
		group_operator: formData.group_operator,
		status: formData.status,
	};

	const [err, res]: any = await asaw(
		createRule(ruleInput, { databaseConfigId })
	);
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_CREATE_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.RULE_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}
