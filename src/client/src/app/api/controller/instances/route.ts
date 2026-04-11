import { getControllerInstances } from "@/lib/platform/controller";

export async function GET() {
	const res = await getControllerInstances();
	return Response.json(res);
}
