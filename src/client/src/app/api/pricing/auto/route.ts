import { autoUpdatePricing } from "@/lib/platform/pricing";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const formData = await request.json();
	const result = await autoUpdatePricing(formData);
	return Response.json(result);
}
