import { getFeatureHandler } from "@/lib/platform/controller/features";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const handler = getFeatureHandler("instrumentation")!;
	return handler.applyOperation(id, "enable", {});
}
