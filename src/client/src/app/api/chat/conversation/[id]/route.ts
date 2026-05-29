import {
	getConversationWithMessages,
	deleteConversation,
} from "@/lib/platform/chat/conversation";
import { getCurrentUser } from "@/lib/session";
import { NextRequest } from "next/server";

export async function GET(
	_: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const { id } = await params;
	const { data, err } = await getConversationWithMessages(id);

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json({ data });
}

export async function DELETE(
	_: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const { id } = await params;
	const { err } = await deleteConversation(id);

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json({ data: "Conversation deleted" });
}
