import { runQuery } from "@/lib/platform/dashlit/query";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const { query, respectFilters = false, params } = await request.json();

	const res = await runQuery({ query, respectFilters, params });
	return Response.json(res);
}
