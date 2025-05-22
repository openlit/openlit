import { deleteBoard, getBoardById, setMainDashboard } from "@/lib/platform/manage-dashboard/board";
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

export async function PATCH(
	request: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const body = await request.json();
	if (body.setMain) {
		const res = await setMainDashboard(id);
		return Response.json(res);
	}
	return Response.json({ err: "Invalid PATCH request" }, { status: 400 });
}
