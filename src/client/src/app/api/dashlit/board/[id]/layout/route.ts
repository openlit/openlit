import {
	getBoardLayout,
	updateBoardLayout,
} from "@/lib/platform/dashlit/board";
import { NextRequest } from "next/server";

export async function GET(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const res = await getBoardLayout(id);
	return Response.json(res);
}

export async function PUT(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const layoutConfig = await request.json();
	const boardId = params.id;

	const res = await updateBoardLayout(boardId, layoutConfig);
	return Response.json(res);
}
