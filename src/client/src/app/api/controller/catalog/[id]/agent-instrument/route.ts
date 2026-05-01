import { getFeatureHandler } from "@/lib/platform/controller/features";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const handler = getFeatureHandler("agent")!;
	return handler.applyOperation(id, "status", {});
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const body = await request.json().catch(() => ({}));
	const handler = getFeatureHandler("agent")!;
	return handler.applyOperation(id, "enable", body);
}

export async function DELETE(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const handler = getFeatureHandler("agent")!;
	return handler.applyOperation(id, "disable", {});
}
