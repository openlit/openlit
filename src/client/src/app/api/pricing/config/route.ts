import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import {
	getPricingConfig,
	setPricingConfig,
	PricingConfigInput,
} from "@/lib/platform/pricing/config";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";

async function GETHandler(_: NextRequest) {
	const config = await getPricingConfig();
	return Response.json({ data: config });
}

async function POSTHandler(request: NextRequest) {
	const startTimestamp = Date.now();
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

	// Anonymous feature-adoption signal: whether auto-pricing is enabled.
	// Boolean only — never the pricing table, API keys, or provider secrets.
	PostHogServer.fireEvent({
		event: SERVER_EVENTS.PRICING_CONFIG_UPDATED,
		properties: { auto: pricingConfig.auto },
		startTimestamp,
	});

	return Response.json({ data });
}

export const GET = withCurrentOrganisationPermission("pricing:read", GETHandler);
export const POST = withAudit(withCurrentOrganisationPermission("pricing:configure", POSTHandler));
