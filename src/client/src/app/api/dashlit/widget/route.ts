import {
	createWidget,
	getWidgets,
	updateWidget,
} from "@/lib/platform/dashlit/widget";
import { Widget } from "@/types/dashlit";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const widget: Widget = await request.json();

	const res = await createWidget(widget);
	return Response.json(res);
}

export async function PUT(request: NextRequest) {
	const widget: Widget = await request.json();

	const res = await updateWidget(widget);
	return Response.json(res);
}

export async function GET() {
	const res = await getWidgets();
	return Response.json(res);
}
