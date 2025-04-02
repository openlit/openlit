import { deleteWidget, getWidgetById } from "@/lib/platform/dashlit/widget";
import { NextRequest } from "next/server";

export async function DELETE(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const res = await deleteWidget(id);
	return Response.json(res);
}

export async function GET(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const res = await getWidgetById(id);
	return Response.json(res);
}
