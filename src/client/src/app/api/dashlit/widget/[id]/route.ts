import {
	deleteWidget,
	getWidgetById,
	updateWidget,
} from "@/lib/platform/dashlit/widget";
import { Widget } from "@/types/dashlit";
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

export async function PUT(request: NextRequest) {
	const widget: Widget = await request.json();

	const res = await updateWidget(widget);
	return Response.json(res);
}
