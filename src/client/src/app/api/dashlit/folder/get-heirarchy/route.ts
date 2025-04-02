import { getHeirarchy } from "@/lib/platform/dashlit/heirarchy";

export async function GET() {
	const res = await getHeirarchy();
	return Response.json(res);
}
