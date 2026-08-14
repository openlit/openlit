import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withConnectorAccess } from "@/lib/access/connector-route";
import { isMemoryConnectorId, memoryConnectorId } from "@/lib/platform/connectors/memory/crud";
import { queryProjectMemories } from "@/lib/platform/connectors/memory/read";
import {
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_INVALID_FILTER,
	MEMORY_INVALID_LIMIT,
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

function parseConnectorId(value: string | null): string | undefined {
	const trimmed = optionalFilter(value, 120);
	if (!trimmed) return undefined;
	const id = memoryConnectorId(trimmed);
	if (!isMemoryConnectorId(id)) {
		throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
	}
	return id;
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

export const GET = withConnectorAccess("read", GETHandler);
