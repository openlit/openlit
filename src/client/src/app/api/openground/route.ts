import OpenLitHelper from "@/helpers/server/openlit";
import { evaluate, getAllOpengroundRequests } from "@/lib/platform/openground";

export async function GET() {
	const response = await getAllOpengroundRequests();
	return Response.json(response);
}

export async function POST(request: Request) {
	const formData = await request.json();

	if (!OpenLitHelper.pricingInfo) await OpenLitHelper.fetchPricingInfo();
	const response = await evaluate(formData);
	return Response.json(response);
}
