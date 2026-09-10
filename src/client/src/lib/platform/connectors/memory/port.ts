/**
 * Copy memories from one connector to another.
 *
 * Writes destination records with `metadata.openlit.port` and persists the
 * same link on the destination ConnectorInstance.
 */

import {
	MEMORY_ADD_UNSUPPORTED,
	MEMORY_CONNECTOR_CONTENT_REQUIRED,
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_COPY_EMPTY,
	MEMORY_COPY_SAME_CONNECTOR,
	MEMORY_COPY_TOO_MANY,
} from "@/constants/messages/en";
import { getMemoryTypeDescriptor } from "./registry";
import {
	listMemoryConnectors,
	memoryConnectorId,
	recordMemoryPortLinks,
} from "./crud";
import { queryProjectMemories, type MemoryListItem } from "./read";
import { addProjectMemories } from "./write";
import {
	memoryContentFingerprint,
	memoryPortMetadata,
	parseMemoryPortLink,
} from "./port-link";
import type { MemoryPortLink } from "./types";

export const MEMORY_COPY_MAX = 50;

export type { MemoryPortLink } from "./types";
export {
	attachMemoryPorts,
	memoryContentFingerprint,
	memoryPortMetadata,
	parseMemoryPortLink,
} from "./port-link";

export interface MemoryCopyInput {
	sourceConnectorId?: string;
	targetConnectorId?: string;
	memoryIds?: string[];
	userId?: string;
	agentId?: string;
	sessionId?: string;
	query?: string;
	targetUserId?: string;
	targetAgentId?: string;
	targetSessionId?: string;
}

export interface MemoryCopyFailure {
	id: string;
	message: string;
}

export interface MemoryCopyResult {
	source: { id: string; name: string; type: string } | null;
	target: { id: string; name: string; type: string } | null;
	copied: number;
	failed: MemoryCopyFailure[];
	memories: MemoryListItem[];
}

function trim(value?: string): string | undefined {
	const next = String(value || "").trim();
	return next || undefined;
}

export async function copyProjectMemories(
	input: MemoryCopyInput
): Promise<MemoryCopyResult> {
	const sourceId = memoryConnectorId(String(input.sourceConnectorId || ""));
	const targetId = memoryConnectorId(String(input.targetConnectorId || ""));
	if (!sourceId.startsWith("memory:") || !targetId.startsWith("memory:")) {
		throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
	}
	if (sourceId === targetId) throw new Error(MEMORY_COPY_SAME_CONNECTOR);

	const connectors = await listMemoryConnectors();
	const source = connectors.find((item) => item.id === sourceId);
	const target = connectors.find((item) => item.id === targetId);
	if (!source || !target) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);

	const targetCapabilities = getMemoryTypeDescriptor(String(target.type))?.capabilities;
	if (!targetCapabilities?.add) throw new Error(MEMORY_ADD_UNSUPPORTED);

	const listed = await queryProjectMemories({
		connectorId: sourceId,
		userId: trim(input.userId),
		agentId: trim(input.agentId),
		sessionId: trim(input.sessionId),
		query: trim(input.query),
		limit: MEMORY_COPY_MAX,
	});
	const wanted = new Set(
		(input.memoryIds || []).map((id) => String(id || "").trim()).filter(Boolean)
	);
	let selected = listed.memories.filter(
		(memory) => !memory.graphOnly && memory.content?.trim()
	);
	if (wanted.size) {
		selected = selected.filter((memory) => wanted.has(memory.id));
	}
	if (!selected.length) throw new Error(MEMORY_COPY_EMPTY);
	if (selected.length > MEMORY_COPY_MAX) throw new Error(MEMORY_COPY_TOO_MANY);

	const copiedAt = new Date().toISOString();
	const created: MemoryListItem[] = [];
	const failed: MemoryCopyFailure[] = [];
	const stored: MemoryPortLink[] = [];

	for (const memory of selected) {
		const fingerprint = memoryContentFingerprint(memory.content, memory.userId);
		const prior = parseMemoryPortLink(memory.metadata);
		const link: MemoryPortLink = {
			sourceConnectorId: sourceId,
			sourceConnectorType: String(source.type || ""),
			sourceConnectorName: String(source.name || ""),
			sourceMemoryId: memory.id,
			originConnectorId: prior?.originConnectorId || prior?.sourceConnectorId,
			originMemoryId: prior?.originMemoryId || prior?.sourceMemoryId,
			copiedAt,
			contentFingerprint: fingerprint,
		};
		try {
			const result = await addProjectMemories({
				connectorId: targetId,
				content: memory.content,
				messages: memory.input,
				userId: trim(input.targetUserId) || memory.userId,
				agentId: trim(input.targetAgentId) || memory.agentId,
				sessionId: trim(input.targetSessionId) || memory.sessionId,
				metadata: memoryPortMetadata(link, memory.metadata),
			});
			const dest = result.memories[0];
			if (!dest) throw new Error(MEMORY_CONNECTOR_CONTENT_REQUIRED);
			const withPort: MemoryListItem = {
				...dest,
				port: { ...link, destMemoryId: dest.id },
			};
			created.push(withPort);
			stored.push(withPort.port!);
		} catch (error) {
			failed.push({
				id: memory.id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	if (stored.length) await recordMemoryPortLinks(targetId, stored);

	return {
		source: { id: String(source.id), name: String(source.name), type: String(source.type) },
		target: { id: String(target.id), name: String(target.name), type: String(target.type) },
		copied: created.length,
		failed,
		memories: created,
	};
}
