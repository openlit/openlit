import { getCollectorInstanceById } from "@/lib/platform/collector";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const res = await getCollectorInstanceById(id);

	if (!res.data || res.data.length === 0) {
		return Response.json(
			{ error: "Collector instance not found" },
			{ status: 404 }
		);
	}

	return Response.json({ data: res.data[0] });
}
