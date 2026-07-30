import { getTraceHierarchy } from "@/lib/platform/traces/read";

export async function GET(request: Request, context: any) {
	const { id } = context.params || {};

	if (!id) {
		return Response.json("No span id provided", {
			status: 400,
		});
	}

	const traceId = new URL(request.url).searchParams.get("traceId") || undefined;
	const environment = request.headers.get("x-openlit-environment") || undefined;
	const res: any = await getTraceHierarchy(id, { traceId, environment });
	return Response.json(res);
}
