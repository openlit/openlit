import { RuleInput } from "@/types/rule-engine";
import { getRuleById, updateRule, deleteRule } from "@/lib/platform/rule-engine";
import asaw from "@/utils/asaw";

export async function GET(_: Request, context: any) {
	const { id } = context.params;
	const { err, data }: any = await getRuleById(id);
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(data);
}

export async function PUT(request: Request, context: any) {
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
		return Response.json(err, { status: 400 });
	}

	return Response.json(res);
}

export async function DELETE(_: Request, context: any) {
	const { id } = context.params;
	const [err, res] = await deleteRule(id);
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(res);
}
