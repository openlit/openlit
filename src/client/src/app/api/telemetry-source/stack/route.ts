import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/utils/api-response";
import {
	createSourceStack,
	listStackTemplates,
} from "@/lib/telemetry-source-crud";
import { TELEMETRY_SOURCE_INVALID_JSON } from "@/constants/messages/en";
import { NextRequest } from "next/server";

export async function GET() {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	return Response.json({ templates: listStackTemplates() });
}

export async function POST(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ err: TELEMETRY_SOURCE_INVALID_JSON }, { status: 400 });
	}

	const [err, result] = await asaw(
		createSourceStack(body as Record<string, unknown>)
	);
	if (err) return errorResponse(err, "Failed to create telemetry source stack");
	return Response.json(result);
}
