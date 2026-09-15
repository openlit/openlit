import {
	getConversationWithMessages,
	deleteConversation,
} from "@/lib/platform/chat/conversation";
import { resolveRequestAuth } from "@/helpers/server/auth";
import { NextRequest } from "next/server";

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const [authErr, auth] = await resolveRequestAuth(request);
	if (authErr || !auth) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const { id } = await params;
	const { data, err } = await getConversationWithMessages(
		id,
		auth.databaseConfigId
	);

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json({ data });
}

export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const [authErr, auth] = await resolveRequestAuth(request);
	if (authErr || !auth) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const { id } = await params;
	const { err } = await deleteConversation(id, auth.databaseConfigId);

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json({ data: "Conversation deleted" });
}
