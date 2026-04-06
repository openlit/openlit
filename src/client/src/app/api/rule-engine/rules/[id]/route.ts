import { SERVER_EVENTS } from "@/constants/events";
import { RuleInput } from "@/types/rule-engine";
import { getRuleById, updateRule, deleteRule } from "@/lib/platform/rule-engine";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";

export async function GET(_: Request, context: any) {
	const startTimestamp = Date.now();
	const { id } = context.params;
	const { err, data }: any = await getRuleById(id);
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_GET_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.RULE_GET_SUCCESS,
		startTimestamp,
	});
	return Response.json(data);
}

export async function PUT(request: Request, context: any) {
	const startTimestamp = Date.now();
	const { id } = context.params;
	const formData = await request.json();

	const ruleInput: Partial<RuleInput> = {
		name: formData.name,
		description: formData.description,
		group_operator: formData.group_operator,
		status: formData.status,
	};

	const [err, res]: any = await asaw(updateRule(id, ruleInput));
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_UPDATE_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.RULE_UPDATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

export async function DELETE(_: Request, context: any) {
	const startTimestamp = Date.now();
	const { id } = context.params;
	const [err, res] = await deleteRule(id);
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_DELETE_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.RULE_DELETE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}
