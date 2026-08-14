import { getHeirarchy } from "@/lib/platform/manage-dashboard/heirarchy";

export async function GET() {
	const res = await getHeirarchy();
	return Response.json(res);
}
