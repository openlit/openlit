import {
	getPricingConfig,
	setPricingConfig,
	PricingConfigInput,
} from "@/lib/platform/pricing/config";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";

export async function GET(_: NextRequest) {
	const config = await getPricingConfig();
	return Response.json({ data: config });
}

export async function POST(request: NextRequest) {
	const formData = await request.json();
	const pricingConfig: PricingConfigInput = {
		id: formData.id,
		auto: !!formData.auto,
		recurringTime: formData.recurringTime || "",
		meta: formData.meta || "{}",
	};

	const [err, data] = await asaw(
		setPricingConfig(pricingConfig, request.nextUrl.origin)
	);

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json({ data });
}
