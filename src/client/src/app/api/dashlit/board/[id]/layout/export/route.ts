import { getBoardLayout } from "@/lib/platform/dashlit/board";
import { NextRequest } from "next/server";

export async function GET(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const res = await getBoardLayout(id);
	if (res.err) {
		return new Response(JSON.stringify({ error: res.err }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}
	const json = JSON.stringify(res.data, null, 2);
	return new Response(json, {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Content-Disposition": `attachment; filename=board-${id}-layout.json`,
		},
	});
}
