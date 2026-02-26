import { RuleEntityInput } from "@/types/rule-engine";
import { getRuleEntities, addRuleEntity, deleteRuleEntity } from "@/lib/platform/rule-engine";
import asaw from "@/utils/asaw";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const filters = {
		rule_id: searchParams.get("rule_id") || undefined,
		entity_type: searchParams.get("entity_type") || undefined,
	};

	const { err, data }: any = await getRuleEntities(filters);
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(data);
}

export async function POST(request: Request) {
	const formData = await request.json();

	const entityInput: Partial<RuleEntityInput> = {
		rule_id: formData.rule_id,
		entity_type: formData.entity_type,
		entity_id: formData.entity_id,
	};

	const [err, res]: any = await asaw(addRuleEntity(entityInput));
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(res);
}

export async function DELETE(request: Request) {
	const { searchParams } = new URL(request.url);
	const id = searchParams.get("id");

	if (!id) {
		const formData = await request.json().catch(() => ({}));
		const entityId = formData.id;
		if (!entityId) {
			return Response.json("Entity id is required", { status: 400 });
		}
		const [err, res] = await deleteRuleEntity(entityId);
		if (err) {
			return Response.json(err, { status: 400 });
		}
		return Response.json(res);
	}

	const [err, res] = await deleteRuleEntity(id);
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(res);
}
