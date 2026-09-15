/**
 * Project-scoped memory writes for the Memory page, API routes, and Otter tools.
 */

import {
	asMemoryListItem,
	resolveProjectMemoryAdapter,
	type MemoryListItem,
	type MemoryQueryResult,
} from "./read";
import { rememberMemoryFilters } from "./crud";
import {
	UnsupportedMemoryCapabilityError,
	type MemoryCapabilities,
	type MemoryMessage,
	type MemoryRecord,
	type MemoryUpdateInput,
	type MemoryWriteInput,
	MEMORY_CONTENT_MAX,
	MEMORY_METADATA_JSON_MAX,
} from "./types";
import {
	MEMORY_ADD_UNSUPPORTED,
	MEMORY_CONNECTOR_CONTENT_REQUIRED,
	MEMORY_CONTENT_TOO_LONG,
	MEMORY_DELETE_UNSUPPORTED,
	MEMORY_DETAIL_NOT_FOUND,
	MEMORY_EDIT_UNSUPPORTED,
	MEMORY_INVALID_METADATA,
} from "@/constants/messages/en";

export interface MemoryWriteResult {
	connector: MemoryQueryResult["connector"];
	capabilities: MemoryCapabilities | null;
	memories: MemoryListItem[];
}

export interface MemoryUpdateResult {
	connector: MemoryQueryResult["connector"];
	capabilities: MemoryCapabilities | null;
	memory: MemoryListItem;
}

export interface MemoryDeleteResult {
	connector: MemoryQueryResult["connector"];
	capabilities: MemoryCapabilities | null;
	ok: true;
}

function trim(value?: string): string | undefined {
	const next = String(value || "").trim();
	return next || undefined;
}

function requireContent(content?: string): string {
	const next = trim(content);
	if (!next) throw new Error(MEMORY_CONNECTOR_CONTENT_REQUIRED);
	if (next.length > MEMORY_CONTENT_MAX) throw new Error(MEMORY_CONTENT_TOO_LONG);
	return next;
}

export function parseMemoryMessages(value: unknown): MemoryMessage[] | undefined {
	if (value == null) return undefined;
	if (!Array.isArray(value)) throw new Error(MEMORY_CONNECTOR_CONTENT_REQUIRED);
	const messages: MemoryMessage[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new Error(MEMORY_CONNECTOR_CONTENT_REQUIRED);
		}
		const row = item as Record<string, unknown>;
		const role = String(row.role || "").trim();
		const content = String(row.content || "").trim();
		if (!role && !content) continue;
		if (!role || !content) throw new Error(MEMORY_CONNECTOR_CONTENT_REQUIRED);
		if (role.length > 64 || content.length > MEMORY_CONTENT_MAX) {
			throw new Error(MEMORY_CONTENT_TOO_LONG);
		}
		messages.push({ role, content });
	}
	return messages.length ? messages : undefined;
}

export function parseMemoryMetadata(
	value: unknown
): Record<string, unknown> | undefined {
	if (value == null) return undefined;
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error(MEMORY_INVALID_METADATA);
	}
	const encoded = JSON.stringify(value);
	if (encoded.length > MEMORY_METADATA_JSON_MAX) {
		throw new Error(MEMORY_INVALID_METADATA);
	}
	return value as Record<string, unknown>;
}

function writeInput(input: {
	content?: string;
	messages?: MemoryMessage[];
	userId?: string;
	agentId?: string;
	sessionId?: string;
	metadata?: Record<string, unknown>;
}): MemoryWriteInput {
	const content = trim(input.content);
	if (content && content.length > MEMORY_CONTENT_MAX) {
		throw new Error(MEMORY_CONTENT_TOO_LONG);
	}
	const messages = input.messages?.length ? input.messages : undefined;
	if (!content && !messages?.length) {
		throw new Error(MEMORY_CONNECTOR_CONTENT_REQUIRED);
	}
	return {
		content,
		messages,
		userId: trim(input.userId),
		agentId: trim(input.agentId),
		sessionId: trim(input.sessionId),
		metadata: input.metadata,
	};
}

export async function addProjectMemories(input: {
	connectorId?: string;
	content?: string;
	messages?: MemoryMessage[];
	userId?: string;
	agentId?: string;
	sessionId?: string;
	metadata?: Record<string, unknown>;
}): Promise<MemoryWriteResult> {
	const payload = writeInput(input);
	const { connector, adapter, capabilities } = await resolveProjectMemoryAdapter(
		input.connectorId
	);
	if (!capabilities.add) throw new Error(MEMORY_ADD_UNSUPPORTED);

	let records: MemoryRecord[];
	try {
		records = await adapter.add(payload);
	} catch (error) {
		if (error instanceof UnsupportedMemoryCapabilityError) {
			throw new Error(MEMORY_ADD_UNSUPPORTED);
		}
		throw error;
	}

	await rememberMemoryFilters(String(connector.id), {
		users: [
			payload.userId,
			...records.map((record) => record.userId?.trim() || ""),
		].filter((id): id is string => !!id),
		sessions: [
			payload.sessionId,
			...records.map((record) => record.sessionId?.trim() || ""),
		].filter((id): id is string => !!id),
		agents: [
			payload.agentId,
			...records.map((record) => record.agentId?.trim() || ""),
		].filter((id): id is string => !!id),
	}).catch(() => undefined);

	return {
		connector,
		capabilities,
		memories: records.map(asMemoryListItem),
	};
}

export async function updateProjectMemory(input: {
	id: string;
	connectorId?: string;
	content: string;
	metadata?: Record<string, unknown>;
}): Promise<MemoryUpdateResult> {
	const id = trim(input.id);
	if (!id) throw new Error(MEMORY_DETAIL_NOT_FOUND);
	const payload: MemoryUpdateInput = {
		content: requireContent(input.content),
		metadata: input.metadata,
	};
	const { connector, adapter, capabilities } = await resolveProjectMemoryAdapter(
		input.connectorId
	);
	if (!capabilities.update) throw new Error(MEMORY_EDIT_UNSUPPORTED);

	let record: MemoryRecord;
	try {
		record = await adapter.update(id, payload);
	} catch (error) {
		if (error instanceof UnsupportedMemoryCapabilityError) {
			throw new Error(MEMORY_EDIT_UNSUPPORTED);
		}
		throw error;
	}

	return {
		connector,
		capabilities,
		memory: asMemoryListItem(record),
	};
}

export async function deleteProjectMemory(input: {
	id: string;
	connectorId?: string;
}): Promise<MemoryDeleteResult> {
	const id = trim(input.id);
	if (!id) throw new Error(MEMORY_DETAIL_NOT_FOUND);
	const { connector, adapter, capabilities } = await resolveProjectMemoryAdapter(
		input.connectorId
	);
	if (!capabilities.delete) throw new Error(MEMORY_DELETE_UNSUPPORTED);

	try {
		await adapter.delete(id);
	} catch (error) {
		if (error instanceof UnsupportedMemoryCapabilityError) {
			throw new Error(MEMORY_DELETE_UNSUPPORTED);
		}
		throw error;
	}

	return { connector, capabilities, ok: true };
}
