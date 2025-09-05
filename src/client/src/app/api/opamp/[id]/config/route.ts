import { updateAgentConfig } from "@/lib/platform/opamp/opamp";

export async function POST(request: Request, context: any) {
	const { id } = context.params;
	const { config } = await request.json();
	console.log(config);
	const res = await updateAgentConfig(id, config);
	console.log(res);
	return Response.json(res);
}