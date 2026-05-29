import { getControllerInstances } from "@/lib/platform/controller";

export async function GET() {
	const res = await getControllerInstances();
	if (res.err) {
		console.error("controller instances error:", res.err);
		return Response.json(
			{ error: "Failed to fetch controller instances" },
			{ status: 500 }
		);
	}
	return Response.json({ data: res.data || [] });
}
