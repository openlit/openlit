import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withMemoryAccess, withMemoryAudit } from "@/lib/access/memory-route";
import { isMemoryConnectorId, memoryConnectorId } from "@/lib/platform/connectors/memory/crud";
import { queryProjectMemories } from "@/lib/platform/connectors/memory/read";
import {
	addProjectMemories,
	parseMemoryMessages,
	parseMemoryMetadata,
} from "@/lib/platform/connectors/memory/write";
import {
	MEMORY_ADD_FAILED,
	MEMORY_ADD_UNSUPPORTED,
	MEMORY_CONNECTOR_CONTENT_REQUIRED,
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_CONNECTOR_SESSION_REQUIRED,
	MEMORY_CONTENT_TOO_LONG,
	MEMORY_INVALID_FILTER,
	MEMORY_INVALID_JSON,
	MEMORY_INVALID_LIMIT,
	MEMORY_INVALID_METADATA,
	MEMORY_LOAD_FAILED,
} from "@/constants/messages/en";

const FILTER_MAX = 200;
const QUERY_MAX = 2000;

function optionalFilter(value: string | null, max = FILTER_MAX): string | undefined {
	if (value == null) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (trimmed.length > max || /[\u0000-\u001f]/.test(trimmed)) {
		throw new Error(MEMORY_INVALID_FILTER);
	}
	return trimmed;
}

function parseLimit(value: string | null): number | undefined {
	if (value == null || !value.trim()) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
		throw new Error(MEMORY_INVALID_LIMIT);
	}
	return Math.floor(parsed);
}

function parseConnectorId(value: string | null | undefined): string | undefined {
	if (value == null) return undefined;
	const trimmed = optionalFilter(String(value), 120);
	if (!trimmed) return undefined;
	const id = memoryConnectorId(trimmed);
	if (!isMemoryConnectorId(id)) {
		throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
	}
	return id;
}

function optionalBodyFilter(value: unknown): string | undefined {
	if (value == null) return undefined;
	if (typeof value !== "string") throw new Error(MEMORY_INVALID_FILTER);
	return optionalFilter(value);
}

function writeStatus(message: string): number {
	if (message === MEMORY_CONNECTOR_NOT_FOUND) return 404;
	if (
		message === MEMORY_ADD_UNSUPPORTED ||
		message === MEMORY_CONNECTOR_CONTENT_REQUIRED ||
		message === MEMORY_CONNECTOR_SESSION_REQUIRED ||
		message === MEMORY_CONTENT_TOO_LONG ||
		message === MEMORY_INVALID_METADATA
	) {
		return 400;
	}
	return 400;
}

async function GETHandler(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	let connectorId: string | undefined;
	let userId: string | undefined;
	let agentId: string | undefined;
	let sessionId: string | undefined;
	let query: string | undefined;
	let limit: number | undefined;
	try {
		const params = request.nextUrl.searchParams;
		connectorId = parseConnectorId(params.get("connectorId"));
		userId = optionalFilter(params.get("userId"));
		agentId = optionalFilter(params.get("agentId"));
		sessionId = optionalFilter(params.get("sessionId"));
		query = optionalFilter(params.get("q"), QUERY_MAX);
		limit = parseLimit(params.get("limit"));
	} catch (error) {
		return errorResponse(error, MEMORY_INVALID_FILTER, 400);
	}

	const [err, result] = await asaw(
		queryProjectMemories({
			connectorId,
			userId,
			agentId,
			sessionId,
			query,
			limit,
		})
	);
	if (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status = message === MEMORY_CONNECTOR_NOT_FOUND ? 404 : 400;
		return errorResponse(err, MEMORY_LOAD_FAILED, status);
	}
	return Response.json(result);
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

	let connectorId: string | undefined;
	let userId: string | undefined;
	let agentId: string | undefined;
	let sessionId: string | undefined;
	let content: string | undefined;
	let messages;
	let metadata;
	try {
		connectorId = parseConnectorId(
			typeof body.connectorId === "string" ? body.connectorId : undefined
		);
		userId = optionalBodyFilter(body.userId);
		agentId = optionalBodyFilter(body.agentId);
		sessionId = optionalBodyFilter(body.sessionId);
		if (body.content != null && typeof body.content !== "string") {
			throw new Error(MEMORY_CONNECTOR_CONTENT_REQUIRED);
		}
		content = typeof body.content === "string" ? body.content : undefined;
		messages = parseMemoryMessages(body.messages);
		metadata = parseMemoryMetadata(body.metadata);
	} catch (error) {
		return errorResponse(error, MEMORY_INVALID_FILTER, 400);
	}

	const [err, result] = await asaw(
		addProjectMemories({
			connectorId,
			content,
			messages,
			userId,
			agentId,
			sessionId,
			metadata,
		})
	);
	if (err) {
		const message = err instanceof Error ? err.message : String(err);
		return errorResponse(err, MEMORY_ADD_FAILED, writeStatus(message));
	}
	return Response.json(result);
}

export const GET = withMemoryAccess("read", GETHandler);
export const POST = withMemoryAudit(withMemoryAccess("create", POSTHandler));
