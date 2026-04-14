import { streamText, generateText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import { getChatSystemPrompt } from "./schema-context";
import { validateSQL, extractSQLFromResponse } from "./sql-validator";
import { dataCollector } from "../common";
import {
	addMessage,
	getConversationMessages,
	updateConversation,
} from "./conversation";
import { getChatTools } from "./tools";

// ==================== Provider Factories ====================

type ProviderFactory = (apiKey: string) => any;

const providerFactories: Record<string, ProviderFactory> = {
	openai: (apiKey) => createOpenAI({ apiKey }),
	anthropic: (apiKey) => createAnthropic({ apiKey }),
	google: () => google,
	mistral: (apiKey) => createMistral({ apiKey }),
	cohere: (apiKey) => createCohere({ apiKey }),
	groq: (apiKey) => createOpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey }),
	perplexity: (apiKey) => createOpenAI({ baseURL: "https://api.perplexity.ai", apiKey }),
	azure: (apiKey) => createOpenAI({
		baseURL: process.env.AZURE_OPENAI_ENDPOINT || "https://your-resource.openai.azure.com",
		apiKey,
		headers: { "api-key": apiKey },
	}),
	together: (apiKey) => createOpenAI({ baseURL: "https://api.together.xyz/v1", apiKey }),
	fireworks: (apiKey) => createOpenAI({ baseURL: "https://api.fireworks.ai/inference/v1", apiKey }),
	deepseek: (apiKey) => createOpenAI({ baseURL: "https://api.deepseek.com", apiKey }),
	xai: (apiKey) => createOpenAI({ baseURL: "https://api.x.ai/v1", apiKey }),
	huggingface: (apiKey) => createOpenAI({ baseURL: "https://api-inference.huggingface.co/v1", apiKey }),
	replicate: (apiKey) => createOpenAI({ baseURL: "https://openai-proxy.replicate.com/v1", apiKey }),
};

const VALID_PROVIDERS = Object.keys(providerFactories);

export function getModelInstance(providerId: string, apiKey: string, modelName: string) {
	if (!VALID_PROVIDERS.includes(providerId)) {
		throw new Error(`Provider ${providerId} not supported`);
	}
	const factory = providerFactories[providerId];
	const provider = factory(apiKey);
	if (typeof provider === "function") return provider(modelName);
	if (typeof provider === "object" && provider !== null) return provider(modelName);
	throw new Error(`Invalid provider instance for ${providerId}`);
}

// ==================== Error Formatting ====================

export function formatStreamError(e: any): string {
	if (e?.statusCode === 401 || e?.data?.error?.code === "invalid_api_key") {
		return "Invalid API key. Please check your API key in Chat Settings and Vault.";
	} else if (e?.statusCode === 429) {
		return "Rate limit exceeded. Please wait a moment and try again.";
	} else if (e?.statusCode === 403) {
		return "Access denied. Your API key may not have permission for this model.";
	} else if (e?.statusCode === 404) {
		return "Model not found. Please check the model name in Chat Settings.";
	} else if (e?.statusCode >= 500) {
		return "The AI provider is experiencing issues. Please try again later.";
	} else if (e?.message) {
		return e.message.replace(/[a-zA-Z0-9_\-:=+/]{30,}/g, "***");
	}
	return "An error occurred while generating the response.";
}

// ==================== Build Messages ====================

export async function buildConversationMessages(
	conversationId: string,
	content: string
): Promise<{ role: "user" | "assistant"; content: string }[]> {
	const { data: history } = await getConversationMessages(conversationId, 20);
	const messages: { role: "user" | "assistant"; content: string }[] = [];

	if (history && history.length > 0) {
		for (const msg of history) {
			if (msg.role === "user" || msg.role === "assistant") {
				messages.push({ role: msg.role, content: msg.content });
			}
		}
	}

	if (messages.length === 0 || messages[messages.length - 1].content !== content) {
		messages.push({ role: "user", content });
	}

	return messages;
}

// ==================== Stream Chat ====================

export interface StreamChatParams {
	conversationId: string;
	content: string;
	provider: string;
	apiKey: string;
	model: string;
	userId: string;
	dbConfigId: string;
}

export interface StreamChatResult {
	responseText: string;
	streamError: any;
}

/**
 * Execute a streaming chat request. Returns the full response text and any stream error.
 * Also handles:
 * - Saving assistant message with token/cost stats
 * - Executing SQL blocks and appending results
 * - Generating conversation title for first message
 * - Handling tool call fallback text
 */
export async function streamChatMessage(params: StreamChatParams): Promise<StreamChatResult> {
	const { conversationId, content, provider, apiKey, model, userId, dbConfigId } = params;

	// Save user message
	await addMessage({ conversationId, role: "user", content });

	// Build messages
	const messages = await buildConversationMessages(conversationId, content);

	// Create model instance
	const modelInstance = getModelInstance(provider, apiKey, model);

	const isFirstMessage = messages.filter((m) => m.role === "user").length === 1;
	const tools = getChatTools(userId, dbConfigId);

	let streamError: any = null;

	const result = streamText({
		model: modelInstance,
		system: getChatSystemPrompt(),
		messages,
		tools,
		stopWhen: stepCountIs(3),
		onError: ({ error }) => {
			streamError = error;
		},
		onFinish: async ({ text, usage, steps }) => {
			const promptTokens = usage?.inputTokens ?? 0;
			const completionTokens = usage?.outputTokens ?? 0;
			const cost = (promptTokens * 0.003 + completionTokens * 0.015) / 1000;

			let finalText = text;
			if (!finalText && steps) {
				const summaries: string[] = [];
				for (const step of steps) {
					if (step.toolResults) {
						for (const tr of step.toolResults as any[]) {
							const r = tr.result;
							if (r?.success) {
								let msg = `**${r.message}**`;
								if (r.details) msg += `\n\n${r.details}`;
								summaries.push(msg);
							} else if (r?.error) {
								summaries.push(`**Error:** ${r.error}`);
							}
						}
					}
				}
				if (summaries.length > 0) finalText = summaries.join("\n\n");
			}

			// Execute SQL blocks and append results
			let contentToSave = finalText || "";
			if (contentToSave) {
				const sqlBlocks = extractSQLFromResponse(contentToSave);
				for (const sql of sqlBlocks) {
					const validation = validateSQL(sql);
					if (validation.valid && validation.query) {
						try {
							const { data: queryData, err: queryErr } = await dataCollector({
								query: validation.query,
								enable_readonly: true,
							});
							if (!queryErr && queryData) {
								const resultJson = JSON.stringify(queryData);
								const escapedSql = sql.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
								const sqlBlockRegex = new RegExp(
									"```sql\\s*\\n" + escapedSql.replace(/\n/g, "\\n") + "\\s*\\n?```"
								);
								if (sqlBlockRegex.test(contentToSave)) {
									contentToSave = contentToSave.replace(
										sqlBlockRegex,
										(match) => `${match}\n\`\`\`query-result\n${resultJson}\n\`\`\``
									);
								} else {
									contentToSave += `\n\n\`\`\`query-result\n${resultJson}\n\`\`\``;
								}
							}
						} catch {
							// Skip failed queries
						}
					}
				}
			}

			await addMessage({
				conversationId,
				role: "assistant",
				content: contentToSave,
				promptTokens,
				completionTokens,
				cost,
			});

			await updateConversation(conversationId, {
				addPromptTokens: promptTokens,
				addCompletionTokens: completionTokens,
				addCost: cost,
				incrementMessages: true,
			});

			if (isFirstMessage && finalText) {
				generateConversationTitle(provider, apiKey, model, content, finalText, conversationId).catch(() => {
					updateConversation(conversationId, {
						title: content.slice(0, 50) + (content.length > 50 ? "..." : ""),
					}).catch(() => {});
				});
			}
		},
	});

	// Consume the stream
	const fullStream = result.fullStream;
	const parts: string[] = [];
	let hasText = false;
	const toolResultMessages: string[] = [];

	for await (const part of fullStream) {
		if (part.type === "text-delta" && (part as any).text) {
			hasText = true;
			parts.push((part as any).text);
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

	if (!hasText && toolResultMessages.length > 0) {
		parts.push(toolResultMessages.join("\n\n"));
	}

	let responseText = parts.join("");

	// Handle API errors
	if (!responseText && streamError) {
		const errorMsg = formatStreamError(streamError);
		responseText = `**Error:** ${errorMsg}`;
		await addMessage({ conversationId, role: "assistant", content: responseText });
	}

	return { responseText, streamError };
}

// ==================== Title Generation ====================

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
