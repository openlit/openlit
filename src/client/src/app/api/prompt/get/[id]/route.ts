import { getPromptDetails } from "@/lib/platform/prompt";
import { errorResponse } from "@/helpers/server/response";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest, context: any) {
	const { searchParams } = request.nextUrl;
	const version = searchParams.get("version") || undefined;
	const { id } = context.params || {};

	const res: any = await getPromptDetails(id, { version });
	if (res?.err) return errorResponse(res.err, 404);

	return Response.json(res);
}
