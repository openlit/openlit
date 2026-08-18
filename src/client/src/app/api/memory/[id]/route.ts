import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withMemoryAccess, withMemoryAudit } from "@/lib/access/memory-route";
import { isMemoryConnectorId, memoryConnectorId } from "@/lib/platform/connectors/memory/crud";
import { getProjectMemory } from "@/lib/platform/connectors/memory/read";
import {
	deleteProjectMemory,
	parseMemoryMetadata,
	updateProjectMemory,
} from "@/lib/platform/connectors/memory/write";
import {
	MEMORY_CONNECTOR_CONTENT_REQUIRED,
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_CONTENT_TOO_LONG,
	MEMORY_DELETE_FAILED,
	MEMORY_DETAIL_LOAD_FAILED,
	MEMORY_DETAIL_NOT_FOUND,
	MEMORY_EDIT_FAILED,
	MEMORY_INVALID_FILTER,
	MEMORY_INVALID_JSON,
	MEMORY_INVALID_METADATA,
} from "@/constants/messages/en";

const ID_MAX = 200;

function parseId(value: string): string {
	const trimmed = String(value || "").trim();
	if (!trimmed || trimmed.length > ID_MAX || /[\u0000-\u001f]/.test(trimmed)) {
		throw new Error(MEMORY_INVALID_FILTER);
	}
	return trimmed;
}

function parseConnectorId(value: string | null | undefined): string | undefined {
	if (value == null) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (trimmed.length > 120 || /[\u0000-\u001f]/.test(trimmed)) {
		throw new Error(MEMORY_INVALID_FILTER);
	}
	const id = memoryConnectorId(trimmed);
	if (!isMemoryConnectorId(id)) {
		throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
	}
	return id;
}

function mutationStatus(message: string): number {
	if (message === MEMORY_DETAIL_NOT_FOUND || message === MEMORY_CONNECTOR_NOT_FOUND) {
		return 404;
	}
	return 400;
}

async function GETHandler(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	let id: string;
	let connectorId: string | undefined;
	try {
		id = parseId(params.id);
		connectorId = parseConnectorId(request.nextUrl.searchParams.get("connectorId"));
	} catch (error) {
		return errorResponse(error, MEMORY_INVALID_FILTER, 400);
	}

	const [err, result] = await asaw(getProjectMemory({ id, connectorId }));
	if (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status =
			message === MEMORY_DETAIL_NOT_FOUND || message === MEMORY_CONNECTOR_NOT_FOUND
				? 404
				: 400;
		return errorResponse(err, MEMORY_DETAIL_LOAD_FAILED, status);
	}
	return Response.json(result);
}

async function PATCHHandler(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	let id: string;
	let connectorId: string | undefined;
	try {
		id = parseId(params.id);
		connectorId = parseConnectorId(request.nextUrl.searchParams.get("connectorId"));
	} catch (error) {
		return errorResponse(error, MEMORY_INVALID_FILTER, 400);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse(MEMORY_INVALID_JSON, MEMORY_INVALID_JSON, 400);
	}

	let content: string;
	let metadata;
	try {
		if (typeof body.connectorId === "string" && !connectorId) {
			connectorId = parseConnectorId(body.connectorId);
		}
		if (typeof body.content !== "string") {
			throw new Error(MEMORY_CONNECTOR_CONTENT_REQUIRED);
		}
		content = body.content;
		metadata = parseMemoryMetadata(body.metadata);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const fallback =
			message === MEMORY_INVALID_METADATA ||
			message === MEMORY_CONTENT_TOO_LONG ||
			message === MEMORY_CONNECTOR_CONTENT_REQUIRED
				? message
				: MEMORY_INVALID_FILTER;
		return errorResponse(error, fallback, 400);
	}

	const [err, result] = await asaw(
		updateProjectMemory({ id, connectorId, content, metadata })
	);
	if (err) {
		const message = err instanceof Error ? err.message : String(err);
		return errorResponse(err, MEMORY_EDIT_FAILED, mutationStatus(message));
	}
	return Response.json(result);
}

async function DELETEHandler(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	let id: string;
	let connectorId: string | undefined;
	try {
		id = parseId(params.id);
		connectorId = parseConnectorId(request.nextUrl.searchParams.get("connectorId"));
	} catch (error) {
		return errorResponse(error, MEMORY_INVALID_FILTER, 400);
	}

	const [err, result] = await asaw(deleteProjectMemory({ id, connectorId }));
	if (err) {
		const message = err instanceof Error ? err.message : String(err);
		return errorResponse(err, MEMORY_DELETE_FAILED, mutationStatus(message));
	}
	return Response.json(result);
}

export const GET = withMemoryAccess("read", GETHandler);
export const PATCH = withMemoryAudit(withMemoryAccess("update", PATCHHandler));
export const DELETE = withMemoryAudit(withMemoryAccess("delete", DELETEHandler));
