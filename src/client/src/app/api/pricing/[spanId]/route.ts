import { setPricingForSpanId } from "@/lib/platform/pricing";
import asaw from "@/utils/asaw";

export async function POST(_request: Request, props: { params: Promise<{ spanId: string }> }) {
    const params = await props.params;
    const { spanId } = params;
    const [err, res] = await asaw(setPricingForSpanId(spanId));

    if (err) {
		return Response.json({ success: false, err: err.message || String(err) }, { status: 400 });
	}

    return Response.json(res);
}
