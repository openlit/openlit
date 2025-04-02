import { getBoardLayout } from "@/lib/platform/dashlit/board";
import { NextRequest } from "next/server";

export async function GET(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const res = await getBoardLayout(id);
	return Response.json(res);
}
