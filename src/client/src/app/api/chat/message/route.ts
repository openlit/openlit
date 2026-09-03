import { SERVER_EVENTS } from "@/constants/events";
import { resolveRequestAuth } from "@/helpers/server/auth";
import { getDBConfigByUser } from "@/lib/db-config";
import { getChatConfigWithApiKey } from "@/lib/platform/chat/config";
import { streamChatMessage, formatStreamError } from "@/lib/platform/chat/stream";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";

async function resolveDatabaseConfigId(authDatabaseConfigId?: string) {
	if (authDatabaseConfigId) return authDatabaseConfigId;
	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	return (dbConfig as { id?: string } | null | undefined)?.id || "";
}

export async function POST(request: NextRequest) {
	const startTimestamp = Date.now();
	const [authErr, auth] = await resolveRequestAuth(request);
	if (authErr || !auth?.userId) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OTTER_CHAT_MESSAGE_FAILURE,
			startTimestamp,
			properties: { reason: "unauthorized" },
		});
		return Response.json("Unauthorized", { status: 401 });
	}

	const body = await request.json();
	const { conversationId, content } = body;

	if (!conversationId || !content) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OTTER_CHAT_MESSAGE_FAILURE,
			startTimestamp,
			properties: { reason: "missing_conversation_or_content" },
		});
		return Response.json("Missing conversationId or content", { status: 400 });
	}

	const dbConfigId = await resolveDatabaseConfigId(auth.databaseConfigId);
	const { data: config, err: configErr } = await getChatConfigWithApiKey(
		dbConfigId || undefined
	);
	if (configErr || !config) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OTTER_CHAT_MESSAGE_FAILURE,
			startTimestamp,
			properties: { reason: "missing_config", conversationId },
		});
		return Response.json(
			configErr || "Chat not configured. Please set up your AI provider.",
			{ status: 400 }
		);
	}

	const environment =
		request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) || undefined;

	try {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				const send = (event: Record<string, unknown>) =>
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				try {
					const { responseText } = await streamChatMessage({
						conversationId,
						content,
						provider: config.provider,
						apiKey: config.apiKey,
						model: config.model,
						userId: auth.userId!,
						dbConfigId,
						environment,
						onDelta: (text) => send({ type: "delta", text }),
						onStep: (label, status = "active", detail) =>
							send({ type: "step", status, label, detail }),
					});
					if (!responseText) {
						send({
							type: "delta",
							text: "**Error:** No response received. Please check your Chat Settings.",
						});
					}
					PostHogServer.fireEvent({
						event: responseText
							? SERVER_EVENTS.OTTER_CHAT_MESSAGE_SUCCESS
							: SERVER_EVENTS.OTTER_CHAT_MESSAGE_FAILURE,
						startTimestamp,
						properties: {
							conversationId,
							provider: config.provider,
							model: config.model,
							dbConfigId,
							reason: responseText ? undefined : "empty_response",
						},
					});
					send({ type: "done" });
				} catch (e: any) {
					PostHogServer.fireEvent({
						event: SERVER_EVENTS.OTTER_CHAT_MESSAGE_FAILURE,
						startTimestamp,
						properties: {
							conversationId,
							provider: config.provider,
							model: config.model,
							dbConfigId,
							error: formatStreamError(e),
						},
					});
					send({ type: "error", error: formatStreamError(e) });
				} finally {
					controller.close();
				}
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "application/x-ndjson; charset=utf-8",
				"Cache-Control": "no-cache, no-transform",
			},
		});
	} catch (e: any) {
		const errorMsg = formatStreamError(e);
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OTTER_CHAT_MESSAGE_FAILURE,
			startTimestamp,
			properties: { conversationId, error: errorMsg },
		});
		return new Response(`**Error:** ${errorMsg}`, {
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	}
}
