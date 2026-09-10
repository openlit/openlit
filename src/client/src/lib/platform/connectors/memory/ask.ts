/**
 * Compact prompt builder for Ask Otter on the Memory page.
 * Only passes identity filters the active connector declares.
 * Data should come from memory connector tools (list/search) when available.
 */

import {
	MEMORY_ASK_FALLBACK_PROMPT,
	MEMORY_ASK_OTTER_PROMPT,
	MEMORY_ASK_REQUIRED_FILTERS,
	MEMORY_ASK_SELECTED_PROMPT,
	MEMORY_ASK_TOOLS_PROMPT,
} from "@/constants/messages/en";
import type { MemoryFilterKey } from "./types";

export interface MemoryAskScope {
	connectorId?: string;
	userId?: string;
	agentId?: string;
	sessionId?: string;
	memoryId?: string;
	memoryContent?: string;
	/** Identity keys this connector supports (from filterFields). */
	filterKeys?: MemoryFilterKey[];
	/** Connector capabilities — prefer tools when list/search exist. */
	canList?: boolean;
	canSearch?: boolean;
}

const SELECTED_CONTENT_MAX = 120;
const SELECTED_CHIP_MAX = 48;

export function memoryAskExcerpt(value?: string, max = SELECTED_CONTENT_MAX): string {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	if (!text) return "";
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function memoryAskSelectedSummary(scope: MemoryAskScope = {}): string | undefined {
	const summary = memoryAskExcerpt(scope.memoryContent, SELECTED_CHIP_MAX);
	return summary || scope.memoryId || undefined;
}

export function buildMemoryAskPrompt(question: string, scope: MemoryAskScope = {}): string {
	const text = question.trim();
	const canList = scope.canList === true;
	const canSearch = scope.canSearch === true;
	const useConnectorApi = canList || canSearch;
	const keys = new Set(scope.filterKeys || []);
	const allow = (key: MemoryFilterKey) =>
		keys.size === 0 ? true : keys.has(key);

	const filters = [
		scope.connectorId ? `connector_id=${scope.connectorId}` : "",
		allow("userId") && scope.userId ? `user_id=${scope.userId}` : "",
		allow("agentId") && scope.agentId ? `agent_id=${scope.agentId}` : "",
		allow("sessionId") && scope.sessionId ? `session_id=${scope.sessionId}` : "",
	].filter(Boolean);

	const lines: string[] = [
		useConnectorApi ? MEMORY_ASK_TOOLS_PROMPT : MEMORY_ASK_FALLBACK_PROMPT,
		MEMORY_ASK_OTTER_PROMPT,
	];

	if (filters.length) {
		lines.push(MEMORY_ASK_REQUIRED_FILTERS(filters.join(", ")));
	}

	if (scope.memoryId) {
		lines.push(
			MEMORY_ASK_SELECTED_PROMPT(
				scope.memoryId,
				memoryAskExcerpt(scope.memoryContent, SELECTED_CONTENT_MAX)
			)
		);
	}

	lines.push("", text);
	return lines.join("\n");
}
