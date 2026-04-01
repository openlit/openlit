import { SERVER_EVENTS } from "@/constants/events";
import { RuleInput } from "@/types/rule-engine";
import { getRules, createRule } from "@/lib/platform/rule-engine";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";

export async function GET() {
	const startTimestamp = Date.now();
	const { err, data }: any = await getRules();
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
