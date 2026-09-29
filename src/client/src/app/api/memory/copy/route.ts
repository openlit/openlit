import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withMemoryAccess, withMemoryAudit } from "@/lib/access/memory-route";
import { isMemoryConnectorId, memoryConnectorId } from "@/lib/platform/connectors/memory/crud";
import { copyProjectMemories } from "@/lib/platform/connectors/memory/port";
import {
	MEMORY_ADD_UNSUPPORTED,
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_COPY_EMPTY,
	MEMORY_COPY_FAILED,
	MEMORY_COPY_SAME_CONNECTOR,
	MEMORY_COPY_TOO_MANY,
	MEMORY_INVALID_FILTER,
	MEMORY_INVALID_JSON,
} from "@/constants/messages/en";

const FILTER_MAX = 200;
const ID_MAX = 200;
const COPY_IDS_MAX = 50;

function optionalFilter(value: unknown, max = FILTER_MAX): string | undefined {
	if (value == null) return undefined;
	if (typeof value !== "string") throw new Error(MEMORY_INVALID_FILTER);
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (trimmed.length > max || /[\u0000-\u001f]/.test(trimmed)) {
		throw new Error(MEMORY_INVALID_FILTER);
	}
	return trimmed;
}

function parseConnectorId(value: unknown): string {
	const trimmed = optionalFilter(value, 120);
	if (!trimmed) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
	const id = memoryConnectorId(trimmed);
	if (!isMemoryConnectorId(id)) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
	return id;
}

function parseMemoryIds(value: unknown): string[] | undefined {
	if (value == null) return undefined;
	if (!Array.isArray(value)) throw new Error(MEMORY_INVALID_FILTER);
	if (value.length > COPY_IDS_MAX) throw new Error(MEMORY_COPY_TOO_MANY);
	return value.map((item) => {
		if (typeof item !== "string") throw new Error(MEMORY_INVALID_FILTER);
		const trimmed = item.trim();
		if (!trimmed || trimmed.length > ID_MAX) throw new Error(MEMORY_INVALID_FILTER);
		return trimmed;
	});
}

function copyStatus(message: string): number {
	if (message === MEMORY_CONNECTOR_NOT_FOUND) return 404;
	if (
		message === MEMORY_ADD_UNSUPPORTED ||
		message === MEMORY_COPY_EMPTY ||
		message === MEMORY_COPY_SAME_CONNECTOR ||
		message === MEMORY_COPY_TOO_MANY
	) {
		return 400;
	}
	return 400;
}

async function POSTHandler(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse(MEMORY_INVALID_JSON, MEMORY_INVALID_JSON, 400);
	}

	let sourceConnectorId: string;
	let targetConnectorId: string;
	let memoryIds: string[] | undefined;
	let userId: string | undefined;
	let agentId: string | undefined;
	let sessionId: string | undefined;
	let query: string | undefined;
	let targetUserId: string | undefined;
	let targetAgentId: string | undefined;
	let targetSessionId: string | undefined;
	try {
		sourceConnectorId = parseConnectorId(body.sourceConnectorId);
		targetConnectorId = parseConnectorId(body.targetConnectorId);
		memoryIds = parseMemoryIds(body.memoryIds);
		userId = optionalFilter(body.userId);
		agentId = optionalFilter(body.agentId);
		sessionId = optionalFilter(body.sessionId);
		query = optionalFilter(body.query, 2000);
		targetUserId = optionalFilter(body.targetUserId);
		targetAgentId = optionalFilter(body.targetAgentId);
		targetSessionId = optionalFilter(body.targetSessionId);
	} catch (error) {
		return errorResponse(error, MEMORY_INVALID_FILTER, 400);
	}

	const [err, result] = await asaw(
		copyProjectMemories({
			sourceConnectorId,
			targetConnectorId,
			memoryIds,
			userId,
			agentId,
			sessionId,
			query,
			targetUserId,
			targetAgentId,
			targetSessionId,
		})
	);
	if (err) {
		const message = err instanceof Error ? err.message : String(err);
		return errorResponse(err, MEMORY_COPY_FAILED, copyStatus(message));
	}
	return Response.json(result);
}

export const POST = withMemoryAudit(withMemoryAccess("create", POSTHandler));
