import { setPricingForSpanId } from "@/lib/platform/pricing";
import asaw from "@/utils/asaw";

export async function POST(
	_request: Request,
	{ params }: { params: { spanId: string } }
) {
	const { spanId } = params;
	const [err, res] = await asaw(setPricingForSpanId(spanId));

	if (err) {
		return Response.json({ success: false, err: err.message || String(err) }, { status: 400 });
	}

	return Response.json(res);
}
