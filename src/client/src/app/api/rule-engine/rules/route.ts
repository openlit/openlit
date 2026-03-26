import { RuleInput } from "@/types/rule-engine";
import { getRules, createRule } from "@/lib/platform/rule-engine";
import asaw from "@/utils/asaw";

export async function GET() {
	const { err, data }: any = await getRules();
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(data);
}

export async function POST(request: Request) {
	const formData = await request.json();

	const ruleInput: Partial<RuleInput> = {
		name: formData.name,
		description: formData.description,
		group_operator: formData.group_operator,
		status: formData.status,
	};

	const [err, res]: any = await asaw(createRule(ruleInput));
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(res);
}
