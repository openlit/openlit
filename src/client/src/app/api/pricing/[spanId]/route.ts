import { setPricingForSpanId } from "@/lib/platform/pricing";
import asaw from "@/utils/asaw";

export async function POST(
	request: Request,
	{ params }: { params: { spanId: string } }
) {
	const { spanId } = params;
	const url = new URL(request.url);
	const [err, res] = await asaw(
		setPricingForSpanId(spanId, {
			environment: url.searchParams.get("environment") || undefined,
			traceId: url.searchParams.get("traceId") || undefined,
		})
	);

	if (err) {
		return Response.json({ success: false, err: err.message || String(err) }, { status: 400 });
	}

	return Response.json(res);
}
