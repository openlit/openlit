import { getCollectorInstances } from "@/lib/platform/collector";

export async function GET() {
	const res = await getCollectorInstances();
	return Response.json(res);
}
