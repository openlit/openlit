import { dataCollector } from "../common";
import {
	OPENLIT_CHAT_CONVERSATION_TABLE,
	OPENLIT_CHAT_MESSAGE_TABLE,
} from "./table-details";
import Sanitizer from "@/utils/sanitizer";
import { randomUUID } from "crypto";

export interface Conversation {
	id: string;
	title: string;
	conversationType?: "chat";
	meta?: string;
	totalPromptTokens: number;
	totalCompletionTokens: number;
	totalCost: number;
	totalMessages: number;
	provider: string;
	model: string;
	createdAt: string;
	updatedAt: string;
}

export interface ChatMessage {
	id: string;
	conversationId: string;
	role: "user" | "assistant";
	content: string;
	sqlQuery: string;
	queryResult: string;
	widgetType: string;
	promptTokens: number;
	completionTokens: number;
	cost: number;
	provider?: string;
	model?: string;
	queryRowsRead: number;
	queryExecutionTimeMs: number;
	queryBytesRead: number;
	createdAt: string;
}

function toStringValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	return String(value);
}

function toNumberValue(value: unknown): number {
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "number") return Number.isFinite(value) ? value : 0;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function normalizeConversationRow(row: any): Conversation {
	return {
		id: toStringValue(row?.id),
		title: toStringValue(row?.title),
		conversationType: (toStringValue(row?.conversationType) || "chat") as "chat",
		meta: toStringValue(row?.meta),
		totalPromptTokens: toNumberValue(row?.totalPromptTokens),
		totalCompletionTokens: toNumberValue(row?.totalCompletionTokens),
		totalCost: toNumberValue(row?.totalCost),
		totalMessages: toNumberValue(row?.totalMessages),
		provider: toStringValue(row?.provider),
		model: toStringValue(row?.model),
		createdAt: toStringValue(row?.createdAt),
		updatedAt: toStringValue(row?.updatedAt),
	};
}

function normalizeMessageRow(row: any): ChatMessage {
	return {
		id: toStringValue(row?.id),
		conversationId: toStringValue(row?.conversationId),
		role: toStringValue(row?.role) === "assistant" ? "assistant" : "user",
		content: toStringValue(row?.content),
		sqlQuery: toStringValue(row?.sqlQuery),
		queryResult: toStringValue(row?.queryResult),
		widgetType: toStringValue(row?.widgetType),
		promptTokens: toNumberValue(row?.promptTokens),
		completionTokens: toNumberValue(row?.completionTokens),
		cost: toNumberValue(row?.cost),
		provider: toStringValue(row?.provider),
		model: toStringValue(row?.model),
		queryRowsRead: toNumberValue(row?.queryRowsRead),
		queryExecutionTimeMs: toNumberValue(row?.queryExecutionTimeMs),
		queryBytesRead: toNumberValue(row?.queryBytesRead),
		createdAt: toStringValue(row?.createdAt),
	};
}

export async function getConversations(
	databaseConfigId?: string
): Promise<{ data?: Conversation[]; err?: unknown }> {
	const query = `
		SELECT
			id, title,
			conversation_type AS conversationType,
			meta,
			total_prompt_tokens AS totalPromptTokens,
			total_completion_tokens AS totalCompletionTokens,
			total_cost AS totalCost,
			total_messages AS totalMessages,
			provider, model,
			created_at AS createdAt,
			updated_at AS updatedAt
		FROM ${OPENLIT_CHAT_CONVERSATION_TABLE}
		WHERE conversation_type = 'chat'
		ORDER BY updated_at DESC
		LIMIT 50
	`;

	const { data, err } = await dataCollector({ query }, "query", databaseConfigId);

	if (err) {
		return { err };
	}

	return { data: ((data as Conversation[]) || []).map(normalizeConversationRow) };
}

export async function getConversationWithMessages(
	conversationId: string,
	databaseConfigId?: string
): Promise<{ data?: { conversation: Conversation; messages: ChatMessage[] }; err?: unknown }> {
	const safeId = Sanitizer.sanitizeValue(conversationId);

	const convQuery = `
		SELECT
			id, title,
			conversation_type AS conversationType,
			meta,
			total_prompt_tokens AS totalPromptTokens,
			total_completion_tokens AS totalCompletionTokens,
			total_cost AS totalCost,
			total_messages AS totalMessages,
			provider, model,
			created_at AS createdAt,
			updated_at AS updatedAt
		FROM ${OPENLIT_CHAT_CONVERSATION_TABLE}
		WHERE id = '${safeId}' AND conversation_type = 'chat'
		LIMIT 1
	`;

	const { data: convData, err: convErr } = await dataCollector(
		{ query: convQuery },
		"query",
		databaseConfigId
	);

	if (convErr) {
		return { err: convErr };
	}

	const conversations = convData as Conversation[];
	if (!conversations || conversations.length === 0) {
		return { err: "Conversation not found" };
	}

	const msgQuery = `
		SELECT
			id,
			conversation_id AS conversationId,
			role, content,
			sql_query AS sqlQuery,
			query_result AS queryResult,
			widget_type AS widgetType,
			prompt_tokens AS promptTokens,
			completion_tokens AS completionTokens,
			cost,
			provider,
			model,
			query_rows_read AS queryRowsRead,
			query_execution_time_ms AS queryExecutionTimeMs,
			query_bytes_read AS queryBytesRead,
			created_at AS createdAt
		FROM ${OPENLIT_CHAT_MESSAGE_TABLE}
		WHERE conversation_id = '${safeId}'
		ORDER BY created_at ASC
	`;

	const { data: msgData, err: msgErr } = await dataCollector(
		{ query: msgQuery },
		"query",
		databaseConfigId
	);

	if (msgErr) {
		return { err: msgErr };
	}

	return {
		data: {
			conversation: normalizeConversationRow(conversations[0]),
			messages: ((msgData as ChatMessage[]) || []).map(normalizeMessageRow),
		},
	};
}

export async function createConversation(
	title: string,
	provider: string,
	model: string,
	options?: {
		meta?: Record<string, unknown>;
	},
	databaseConfigId?: string
): Promise<{ data?: string; err?: unknown }> {
	const safeTitle = Sanitizer.sanitizeValue(title || "");
	const safeProvider = Sanitizer.sanitizeValue(provider);
	const safeModel = Sanitizer.sanitizeValue(model);
	const meta = JSON.stringify(options?.meta || {});
	const conversationId = randomUUID();

	const { err } = await dataCollector(
		{
			table: OPENLIT_CHAT_CONVERSATION_TABLE,
			values: [
				{
					id: conversationId,
					title: safeTitle,
					conversation_type: "chat",
					meta,
					provider: safeProvider,
					model: safeModel,
				},
			],
		},
		"insert",
		databaseConfigId
	);

	if (err) {
		return { err };
	}

	return { data: conversationId };
}

export async function deleteConversation(
	conversationId: string,
	databaseConfigId?: string
): Promise<{ err?: unknown }> {
	const safeId = Sanitizer.sanitizeValue(conversationId);

	// Delete messages first
	const { err: msgErr } = await dataCollector(
		{
			query: `DELETE FROM ${OPENLIT_CHAT_MESSAGE_TABLE} WHERE conversation_id = '${safeId}'`,
		},
		"exec",
		databaseConfigId
	);

	if (msgErr) {
		return { err: msgErr };
	}

	// Delete conversation
	const { err } = await dataCollector(
		{
			query: `DELETE FROM ${OPENLIT_CHAT_CONVERSATION_TABLE} WHERE id = '${safeId}'`,
		},
		"exec",
		databaseConfigId
	);

	return { err };
}

export async function addMessage(
	{
		conversationId,
		role,
		content,
		sqlQuery,
		queryResult,
		widgetType,
		promptTokens,
		completionTokens,
		cost,
		provider,
		model,
	}: {
		conversationId: string;
		role: "user" | "assistant";
		content: string;
		sqlQuery?: string;
		queryResult?: string;
		widgetType?: string;
		promptTokens?: number;
		completionTokens?: number;
		cost?: number;
		provider?: string;
		model?: string;
	},
	databaseConfigId?: string
): Promise<{ data?: string; err?: unknown }> {
	const messageId = randomUUID();
	const { err } = await dataCollector(
		{
			table: OPENLIT_CHAT_MESSAGE_TABLE,
			values: [
				{
					id: messageId,
					conversation_id: conversationId,
					role,
					content,
					sql_query: sqlQuery || "",
					query_result: queryResult || "",
					widget_type: widgetType || "",
					prompt_tokens: promptTokens || 0,
					completion_tokens: completionTokens || 0,
					cost: cost || 0,
					provider: provider ? Sanitizer.sanitizeValue(provider) : "",
					model: model ? Sanitizer.sanitizeValue(model) : "",
				},
			],
		},
		"insert",
		databaseConfigId
	);

	if (err) {
		return { err };
	}

	return { data: messageId };
}

export async function updateMessage(
	messageId: string,
	updates: {
		queryResult?: string;
		queryRowsRead?: number;
		queryExecutionTimeMs?: number;
		queryBytesRead?: number;
	},
	databaseConfigId?: string
): Promise<{ err?: unknown }> {
	const safeId = Sanitizer.sanitizeValue(messageId);

	const updateValues: string[] = [];
	if (updates.queryResult !== undefined) {
		updateValues.push(`query_result = '${Sanitizer.sanitizeValue(updates.queryResult)}'`);
	}
	if (updates.queryRowsRead !== undefined) {
		updateValues.push(`query_rows_read = ${updates.queryRowsRead}`);
	}
	if (updates.queryExecutionTimeMs !== undefined) {
		updateValues.push(`query_execution_time_ms = ${updates.queryExecutionTimeMs}`);
	}
	if (updates.queryBytesRead !== undefined) {
		updateValues.push(`query_bytes_read = ${updates.queryBytesRead}`);
	}

	if (updateValues.length === 0) return {};

	const query = `
		ALTER TABLE ${OPENLIT_CHAT_MESSAGE_TABLE}
		UPDATE ${updateValues.join(", ")}
		WHERE id = '${safeId}'
	`;

	const { err } = await dataCollector({ query }, "exec", databaseConfigId);
	return { err };
}

export async function updateConversation(
	conversationId: string,
	updates: {
		title?: string;
		addPromptTokens?: number;
		addCompletionTokens?: number;
		addCost?: number;
		incrementMessages?: boolean;
	},
	databaseConfigId?: string
): Promise<{ err?: unknown }> {
	const safeId = Sanitizer.sanitizeValue(conversationId);

	const updateValues: string[] = [
		`updated_at = now()`,
	];

	if (updates.title !== undefined) {
		updateValues.push(`title = '${Sanitizer.sanitizeValue(updates.title)}'`);
	}
	if (updates.addPromptTokens) {
		updateValues.push(`total_prompt_tokens = total_prompt_tokens + ${updates.addPromptTokens}`);
	}
	if (updates.addCompletionTokens) {
		updateValues.push(`total_completion_tokens = total_completion_tokens + ${updates.addCompletionTokens}`);
	}
	if (updates.addCost) {
		updateValues.push(`total_cost = total_cost + ${updates.addCost}`);
	}
	if (updates.incrementMessages) {
		updateValues.push(`total_messages = total_messages + 1`);
	}

	const query = `
		ALTER TABLE ${OPENLIT_CHAT_CONVERSATION_TABLE}
		UPDATE ${updateValues.join(", ")}
		WHERE id = '${safeId}'
	`;

	const { err } = await dataCollector({ query }, "exec", databaseConfigId);
	return { err };
}

export async function getConversationMessages(
	conversationId: string,
	limit: number = 20,
	databaseConfigId?: string
): Promise<{ data?: ChatMessage[]; err?: unknown }> {
	const safeId = Sanitizer.sanitizeValue(conversationId);

	const query = `
		SELECT
			id,
			conversation_id AS conversationId,
			role, content,
			sql_query AS sqlQuery,
			query_result AS queryResult,
			prompt_tokens AS promptTokens,
			completion_tokens AS completionTokens,
			cost,
			provider,
			model,
			created_at AS createdAt
		FROM ${OPENLIT_CHAT_MESSAGE_TABLE}
		WHERE conversation_id = '${safeId}'
		ORDER BY created_at ASC
		LIMIT ${limit}
	`;

	const { data, err } = await dataCollector({ query }, "query", databaseConfigId);

	if (err) {
		return { err };
	}

	return { data: ((data as ChatMessage[]) || []).map(normalizeMessageRow) };
}
