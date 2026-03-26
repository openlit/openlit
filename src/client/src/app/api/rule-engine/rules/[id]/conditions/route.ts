import { RuleConditionGroupInput } from "@/types/rule-engine";
import { addConditionGroupsToRule } from "@/lib/platform/rule-engine";
import asaw from "@/utils/asaw";

export async function POST(request: Request, context: any) {
	const { id } = context.params;
	const formData = await request.json();

	const conditionGroups: RuleConditionGroupInput[] = formData.condition_groups || [];

	const [err, res]: any = await asaw(addConditionGroupsToRule(id, conditionGroups));
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(res);
}
