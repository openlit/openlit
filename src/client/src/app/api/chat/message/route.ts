import { streamText, generateText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import { getCurrentUser } from "@/lib/session";
import { getDBConfigByUser } from "@/lib/db-config";
import { getChatConfigWithApiKey } from "@/lib/platform/chat/config";
import {
	addMessage,
	getConversationMessages,
	updateConversation,
} from "@/lib/platform/chat/conversation";
import { getChatSystemPrompt } from "@/lib/platform/chat/schema-context";
import { getChatTools } from "@/lib/platform/chat/tools";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";

type ProviderFactory = (apiKey: string) => any;

const providerFactories: Record<string, ProviderFactory> = {
	openai: (apiKey: string) => createOpenAI({ apiKey }),
	anthropic: (apiKey: string) => createAnthropic({ apiKey }),
	google: () => google,
	mistral: (apiKey: string) => createMistral({ apiKey }),
	cohere: (apiKey: string) => createCohere({ apiKey }),
	groq: (apiKey: string) =>
		createOpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey }),
	perplexity: (apiKey: string) =>
		createOpenAI({ baseURL: "https://api.perplexity.ai", apiKey }),
	azure: (apiKey: string) =>
		createOpenAI({
			baseURL:
				process.env.AZURE_OPENAI_ENDPOINT ||
				"https://your-resource.openai.azure.com",
			apiKey,
			headers: { "api-key": apiKey },
		}),
	together: (apiKey: string) =>
		createOpenAI({ baseURL: "https://api.together.xyz/v1", apiKey }),
	fireworks: (apiKey: string) =>
		createOpenAI({
			baseURL: "https://api.fireworks.ai/inference/v1",
			apiKey,
		}),
	deepseek: (apiKey: string) =>
		createOpenAI({ baseURL: "https://api.deepseek.com", apiKey }),
	xai: (apiKey: string) =>
		createOpenAI({ baseURL: "https://api.x.ai/v1", apiKey }),
	huggingface: (apiKey: string) =>
		createOpenAI({
			baseURL: "https://api-inference.huggingface.co/v1",
			apiKey,
		}),
	replicate: (apiKey: string) =>
		createOpenAI({
			baseURL: "https://openai-proxy.replicate.com/v1",
			apiKey,
		}),
};

const VALID_PROVIDERS = Object.keys(providerFactories);

function getModelInstance(providerId: string, apiKey: string, modelName: string) {
	if (!VALID_PROVIDERS.includes(providerId)) {
		throw new Error(`Provider ${providerId} not supported`);
	}
	const factory = providerFactories[providerId];
	const provider = factory(apiKey);

	// Provider SDKs return either a callable function or an object
	// For createOpenAI/createAnthropic etc, the result is callable: provider(modelName)
	if (typeof provider === "function") {
		return provider(modelName);
	}
	// For google and similar, they're already a provider object with a callable
	if (typeof provider === "object" && provider !== null) {
		return provider(modelName);
	}
	throw new Error(`Invalid provider instance for ${providerId}`);
}

export async function POST(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const body = await request.json();
	const { conversationId, content } = body;

	if (!conversationId || !content) {
		return Response.json("Missing conversationId or content", {
			status: 400,
		});
	}

	// Load chat config with API key
	const { data: config, err: configErr } = await getChatConfigWithApiKey();

	if (configErr || !config) {
		return Response.json(
			configErr || "Chat not configured. Please set up your AI provider.",
			{ status: 400 }
		);
	}

	// Save the user message
	await addMessage({
		conversationId,
		role: "user",
		content,
	});

	// Load conversation history for context
	const { data: history } = await getConversationMessages(conversationId, 20);

	// Build messages array
	const messages: { role: "user" | "assistant" | "system"; content: string }[] =
		[];

	if (history && history.length > 0) {
		// Include previous messages (exclude the one we just added — it's the last)
		for (const msg of history) {
			if (msg.role === "user" || msg.role === "assistant") {
				messages.push({ role: msg.role, content: msg.content });
			}
		}
	}

	// The current user message should already be in history since we just saved it,
	// but ensure it's there
	if (
		messages.length === 0 ||
		messages[messages.length - 1].content !== content
	) {
		messages.push({ role: "user", content });
	}

	// Create the AI model instance
	const modelInstance = getModelInstance(config.provider, config.apiKey, config.model);

	// Get database config for tool operations
	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	const dbConfigId = (dbConfig as any)?.id || "";

	const isFirstMessage = messages.filter((m) => m.role === "user").length === 1;

	// Get platform tools the LLM can call
	const tools = getChatTools(user.id, dbConfigId);

	// Stream the response
	const result = streamText({
		model: modelInstance,
		system: getChatSystemPrompt(),
		messages,
		tools,
		stopWhen: stepCountIs(3),
		onFinish: async ({ text, usage, steps }) => {
			const promptTokens = usage?.inputTokens ?? 0;
			const completionTokens = usage?.outputTokens ?? 0;
			const cost = (promptTokens * 0.003 + completionTokens * 0.015) / 1000;

			// If the LLM called tools but didn't produce text, build a summary from tool results
			let finalText = text;
			if (!finalText && steps) {
				const toolSummaries: string[] = [];
				for (const step of steps) {
					if (step.toolResults) {
						for (const tr of step.toolResults as any[]) {
							const r = tr.result;
							if (r?.success) {
								let msg = `**${r.message}**`;
								if (r.details) msg += `\n\n${r.details}`;
								toolSummaries.push(msg);
							} else if (r?.error) {
								toolSummaries.push(`**Error:** ${r.error}`);
							}
						}
					}
				}
				if (toolSummaries.length > 0) {
					finalText = toolSummaries.join("\n\n");
				}
			}

			// Save assistant message
			await addMessage({
				conversationId,
				role: "assistant",
				content: finalText || "",
				promptTokens,
				completionTokens,
				cost,
			});

			// Update conversation totals
			await updateConversation(conversationId, {
				addPromptTokens: promptTokens,
				addCompletionTokens: completionTokens,
				addCost: cost,
				incrementMessages: true,
			});

			// Generate title for first message
			if (isFirstMessage && finalText) {
				generateConversationTitle(
					config.provider,
					config.apiKey,
					config.model,
					content,
					finalText,
					conversationId
				).catch(() => {
					updateConversation(conversationId, {
						title: content.slice(0, 50) + (content.length > 50 ? "..." : ""),
					}).catch(() => {});
				});
			}
		},
	});

	// Custom stream that handles both text and tool-call-only responses.
	// Uses fullStream to capture all events: text deltas, tool calls, and tool results.
	// If the LLM produces text, it streams normally.
	// If the LLM only calls tools (no text), we format tool results as markdown and stream that.
	const fullStream = result.fullStream;
	const encoder = new TextEncoder();

	const outputStream = new ReadableStream({
		async start(controller) {
			let hasText = false;
			const toolResultMessages: string[] = [];

			try {
				for await (const part of fullStream) {
					if (part.type === "text-delta" && (part as any).text) {
						hasText = true;
						controller.enqueue(encoder.encode((part as any).text));
					} else if (part.type === "tool-result") {
						const r = (part as any).result;
						if (r?.success) {
							let msg = `**${r.message}**`;
							if (r.details) msg += `\n\n${r.details}`;
							toolResultMessages.push(msg);
						} else if (r?.error) {
							toolResultMessages.push(`**Error:** ${r.error}`);
						}
					}
				}

				// If no text was produced by the LLM but tools were called, send tool summaries
				if (!hasText && toolResultMessages.length > 0) {
					controller.enqueue(encoder.encode(toolResultMessages.join("\n\n")));
				}
			} catch (e) {
				// Stream error gracefully
			} finally {
				controller.close();
			}
		},
	});

	return new Response(outputStream, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

async function generateConversationTitle(
	providerId: string,
	apiKey: string,
	modelName: string,
	userMessage: string,
	assistantResponse: string,
	conversationId: string
) {
	const modelInstance = getModelInstance(providerId, apiKey, modelName);

	const { text: title } = await generateText({
		model: modelInstance,
		prompt: `Generate a short title (max 6 words) summarizing this conversation. User asked: "${userMessage.slice(0, 200)}" Assistant responded about: "${assistantResponse.slice(0, 200)}". Return ONLY the title text, no quotes or punctuation.`,
		maxOutputTokens: 20,
	});

	const cleanTitle = title.trim().replace(/^["']|["']$/g, "");

	if (cleanTitle) {
		await updateConversation(conversationId, { title: cleanTitle });
	}
}
