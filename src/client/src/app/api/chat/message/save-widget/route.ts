import { getCurrentUser } from "@/lib/session";
import { saveQueryAsWidget } from "@/lib/platform/chat/save-widget";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const body = await request.json();
	const { title, description, type, query, properties, boardId } = body;

	if (!title || !type || !query) {
		return Response.json("Missing required fields: title, type, query", {
			status: 400,
		});
	}

	const result = await saveQueryAsWidget({
		title,
		description,
		type,
		query,
		properties,
		boardId,
	});

	if (result.err) {
		return Response.json({ err: result.err }, { status: 400 });
	}

	return Response.json(result);
}
