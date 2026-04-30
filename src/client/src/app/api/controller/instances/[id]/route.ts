import { getControllerInstanceById } from "@/lib/platform/controller";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const res = await getControllerInstanceById(id);

	if (!res.data || res.data.length === 0) {
		return Response.json(
			{ error: "Controller instance not found" },
			{ status: 404 }
		);
	}

	return Response.json({ data: res.data[0] });
}
