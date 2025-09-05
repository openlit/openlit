import { getAgentByInstanceId } from "@/lib/platform/opamp/opamp";

export async function GET(_: Request, context: any) {
	const { id } = context.params;
	const res = await getAgentByInstanceId(id);
	return Response.json(res);
}
