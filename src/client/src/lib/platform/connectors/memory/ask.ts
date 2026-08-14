/**
 * Prompt builder for Ask Otter on the Memory page.
 * Kept free of Prisma so the client can reuse it.
 */

import { MEMORY_ASK_OTTER_PROMPT } from "@/constants/messages/en";

export interface MemoryAskScope {
	connectorId?: string;
	userId?: string;
	agentId?: string;
	sessionId?: string;
}

export function buildMemoryAskPrompt(question: string, scope: MemoryAskScope = {}): string {
	const text = question.trim();
	const lines = [MEMORY_ASK_OTTER_PROMPT];
	const filters = [
		scope.connectorId ? `connector_id=${scope.connectorId}` : "",
		scope.userId ? `user_id=${scope.userId}` : "",
		scope.agentId ? `agent_id=${scope.agentId}` : "",
		scope.sessionId ? `session_id=${scope.sessionId}` : "",
	].filter(Boolean);
	if (filters.length) {
		lines.push(
			`When listing or searching memories, pass ${filters.join(", ")} to the memory tools.`
		);
	}
	lines.push("", text);
	return lines.join("\n");
}
