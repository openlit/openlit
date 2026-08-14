import {
	getConversations,
	createConversation,
} from "@/lib/platform/chat/conversation";
import { getCurrentUser } from "@/lib/session";
import { NextRequest } from "next/server";

export async function GET() {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const { data, err } = await getConversations();

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json({ data });
}

export async function POST(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const body = await request.json();

	const { data, err } = await createConversation(
		body.title || "",
		body.provider || "",
		body.model || ""
	);

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json({ data });
}
