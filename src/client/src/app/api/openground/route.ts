import OpenLitHelper from "@/helpers/openlit";
import { evaluate } from "@/lib/platform/openground";

export async function POST(request: Request) {
	const formData = await request.json();

	if (!OpenLitHelper.pricingInfo) await OpenLitHelper.fetchPricingInfo();
	const response = await evaluate(formData);
	return Response.json(response);
}
