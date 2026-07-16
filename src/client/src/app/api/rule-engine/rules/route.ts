import { SERVER_EVENTS } from "@/constants/events";
import { RuleInput } from "@/types/rule-engine";
import { getRules, createRule } from "@/lib/platform/rule-engine";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";

import { resolveDbConfigId } from "@/helpers/server/auth";

export async function GET(request: Request) {
	const [authErr, databaseConfigId] = await resolveDbConfigId(request);
	if (authErr) {
		return Response.json({ err: authErr }, { status: 401 });
	}

	const { err, data }: any = await getRules(databaseConfigId);
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(data);
}

export async function POST(request: Request) {
	const startTimestamp = Date.now();
	const formData = await request.json();

	const ruleInput: Partial<RuleInput> = {
		name: formData.name,
		description: formData.description,
		group_operator: formData.group_operator,
		status: formData.status,
	};

	const [err, res]: any = await asaw(createRule(ruleInput));
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
