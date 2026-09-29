import {
	getConversations,
	createConversation,
} from "@/lib/platform/chat/conversation";
import { resolveRequestAuth } from "@/helpers/server/auth";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
	const [authErr, auth] = await resolveRequestAuth(request);
	if (authErr || !auth) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const { data, err } = await getConversations(auth.databaseConfigId);

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json({ data });
}

export async function POST(request: NextRequest) {
	const [authErr, auth] = await resolveRequestAuth(request);
	if (authErr || !auth) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const body = await request.json();

	const { data, err } = await createConversation(
		body.title || "",
		body.provider || "",
		body.model || "",
		undefined,
		auth.databaseConfigId
	);

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json({ data });
}
