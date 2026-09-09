import { getFeatureHandler } from "@/lib/platform/controller/features";
import { withControllerProduct } from "@/lib/platform/controller/product";

async function GETHandler(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const handler = getFeatureHandler("agent")!;
	return handler.applyOperation(id, "status", {});
}

async function POSTHandler(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const body = await request.json().catch(() => ({}));
	const handler = getFeatureHandler("agent")!;
	return handler.applyOperation(id, "enable", body);
}

async function DELETEHandler(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const handler = getFeatureHandler("agent")!;
	return handler.applyOperation(id, "disable", {});
}

export const GET = withControllerProduct(GETHandler);
export const POST = withControllerProduct(POSTHandler);
export const DELETE = withControllerProduct(DELETEHandler);
