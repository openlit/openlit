import { storeManualFeedback } from "@/lib/platform/evaluation";

export async function POST(
	request: Request,
	{ params }: { params: { spanId: string } }
) {
	const { spanId } = params;
	const body = await request.json();
	const { rating, comment } = body as {
		rating?: "positive" | "negative" | "neutral";
		comment?: string;
	};

	if (!rating || !["positive", "negative", "neutral"].includes(rating)) {
		return Response.json(
			{ err: "Invalid rating. Must be positive, negative, or neutral." },
			{ status: 400 }
		);
	}

	const res: any = await storeManualFeedback(
		spanId,
		rating,
		comment?.trim() || undefined
	);

	if (res?.err) {
		return Response.json(res, { status: 500 });
	}
	return Response.json({ success: true });
}
