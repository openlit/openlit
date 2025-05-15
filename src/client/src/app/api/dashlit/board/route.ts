import {
	createBoard,
	getBoards,
	updateBoard,
} from "@/lib/platform/dashlit/board";
import { Board } from "@/types/dashlit";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const board: Board = await request.json();

	const res = await createBoard(board);
	return Response.json(res);
}

export async function PUT(request: NextRequest) {
	const board: Board = await request.json();

	const res = await updateBoard(board);
	return Response.json(res);
}

export async function GET() {
	const res = await getBoards();
	return Response.json(res);
}
