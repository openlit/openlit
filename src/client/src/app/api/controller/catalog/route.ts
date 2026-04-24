import { getDiscoveredServices } from "@/lib/platform/controller";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const start = searchParams.get("start") || undefined;
	const end = searchParams.get("end") || undefined;

	const res = await getDiscoveredServices(start, end);
	return Response.json(res);
}
