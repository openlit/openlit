import { getCurrentUser } from "@/lib/session";
import { getDBConfigByUser } from "@/lib/db-config";
import { getChatConfigWithApiKey } from "@/lib/platform/chat/config";
import { streamChatMessage, formatStreamError } from "@/lib/platform/chat/stream";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";

export async function POST(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const body = await request.json();
	const { conversationId, content } = body;

	if (!conversationId || !content) {
		return Response.json("Missing conversationId or content", { status: 400 });
	}

	const { data: config, err: configErr } = await getChatConfigWithApiKey();
	if (configErr || !config) {
		return Response.json(
			configErr || "Chat not configured. Please set up your AI provider.",
			{ status: 400 }
		);
	}

	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	const dbConfigId = (dbConfig as any)?.id || "";

	try {
		const { responseText } = await streamChatMessage({
			conversationId,
			content,
			provider: config.provider,
			apiKey: config.apiKey,
			model: config.model,
			userId: user.id,
			dbConfigId,
		});

		return new Response(
			responseText || "**Error:** No response received. Please check your Chat Settings.",
			{ headers: { "Content-Type": "text/plain; charset=utf-8" } }
		);
	} catch (e: any) {
		const errorMsg = formatStreamError(e);
		return new Response(`**Error:** ${errorMsg}`, {
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	}
}
