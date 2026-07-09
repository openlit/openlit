import { getTraceHierarchy } from "@/lib/platform/traces/read";

export async function GET(_: Request, context: any) {
	const { id } = context.params || {};

	if (!id) {
		return Response.json("No span id provided", {
			status: 400,
		});
	}

	const res: any = await getTraceHierarchy(id);
	return Response.json(res);
}
