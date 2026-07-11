import { getTraceExist } from "@/lib/platform/traces/read";

export async function POST() {
	const res = await getTraceExist();
	const { data } = res;
	if ((data as any[])?.[0]?.total_requests > 0) {
		return Response.json(true);
	}

	return Response.json(false);
}
