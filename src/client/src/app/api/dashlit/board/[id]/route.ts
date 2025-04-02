import { deleteBoard, getBoardById } from "@/lib/platform/dashlit/board";
import { NextRequest } from "next/server";

export async function DELETE(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const res = await deleteBoard(id);
	return Response.json(res);
}

export async function GET(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const res = await getBoardById(id);
	return Response.json(res);
}
