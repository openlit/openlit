import { getAllAgents } from "@/lib/platform/opamp/opamp";

export async function GET() {
	const res: any = await getAllAgents();
	return Response.json(res);
}