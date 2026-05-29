import { getDiscoveredServices } from "@/lib/platform/controller";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const start = searchParams.get("start") || undefined;
	const end = searchParams.get("end") || undefined;

	const res = await getDiscoveredServices(start, end);
	if (res.err) {
		console.error("controller catalog error:", res.err);
		return Response.json(
			{ error: "Failed to fetch services" },
			{ status: 500 }
		);
	}
	return Response.json({ data: res.data || [] });
}
