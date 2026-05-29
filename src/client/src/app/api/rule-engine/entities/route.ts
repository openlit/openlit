import { SERVER_EVENTS } from "@/constants/events";
import { RuleEntityInput } from "@/types/rule-engine";
import { getRuleEntities, addRuleEntity, deleteRuleEntity } from "@/lib/platform/rule-engine";
import {
	addRuleToEvaluationType,
	removeRuleFromEvaluationType,
} from "@/lib/platform/evaluation/sync-rule-entities";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";

export async function GET(request: Request) {
	const startTimestamp = Date.now();
	const { searchParams } = new URL(request.url);
	const filters = {
		rule_id: searchParams.get("rule_id") || undefined,
		entity_type: searchParams.get("entity_type") || undefined,
		entity_id: searchParams.get("entity_id") || undefined,
	};

	const { err, data }: any = await getRuleEntities(filters);
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_ENTITIES_LIST_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.RULE_ENTITIES_LIST_SUCCESS,
		startTimestamp,
	});
	return Response.json(data);
}

export async function POST(request: Request) {
	const startTimestamp = Date.now();
	const formData = await request.json();

	const entityInput: Partial<RuleEntityInput> = {
		rule_id: formData.rule_id,
		entity_type: formData.entity_type,
		entity_id: formData.entity_id,
	};

	const [err, res]: any = await asaw(addRuleEntity(entityInput));
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_ENTITIES_CREATE_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}
	if (
		entityInput.entity_type === "evaluation" &&
		entityInput.entity_id &&
		entityInput.rule_id
	) {
		await addRuleToEvaluationType(
			entityInput.rule_id,
			entityInput.entity_id,
			0
		);
	}
	PostHogServer.fireEvent({
		event: SERVER_EVENTS.RULE_ENTITIES_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

export async function DELETE(request: Request) {
	const startTimestamp = Date.now();
	const { searchParams } = new URL(request.url);
	let id = searchParams.get("id");
	if (!id) {
		const body = await request.json().catch(() => ({}));
		id = body.id;
	}
	if (!id) {
		return Response.json("Entity id is required", { status: 400 });
	}

	const { err: fetchErr, data: entities } = (await getRuleEntities({
		id,
	})) as { err?: any; data?: Array<{ id: string; rule_id: string; entity_type: string; entity_id: string }> };
	const entity = !fetchErr && entities?.[0] ? entities[0] : null;

	const [err, res] = await deleteRuleEntity(id);
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_ENTITIES_DELETE_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}
	if (
		entity &&
		entity.entity_type === "evaluation" &&
		entity.entity_id &&
		entity.rule_id
	) {
		await removeRuleFromEvaluationType(entity.rule_id, entity.entity_id);
	}
	PostHogServer.fireEvent({
		event: SERVER_EVENTS.RULE_ENTITIES_DELETE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}
