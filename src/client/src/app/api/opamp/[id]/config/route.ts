import { updateAgentConfig } from "@/lib/platform/opamp/opamp";

export async function POST(request: Request, context: any) {
	const { id } = context.params;
	const { config } = await request.json();
	const res = await updateAgentConfig(id, config);
	return Response.json(res);
}