import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withConnectorAccess } from "@/lib/access/connector-route";
import { isMemoryConnectorId, memoryConnectorId } from "@/lib/platform/connectors/memory/crud";
import { getProjectMemory } from "@/lib/platform/connectors/memory/read";
import {
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_DETAIL_LOAD_FAILED,
	MEMORY_DETAIL_NOT_FOUND,
	MEMORY_INVALID_FILTER,
} from "@/constants/messages/en";

const ID_MAX = 200;

function parseId(value: string): string {
	const trimmed = String(value || "").trim();
	if (!trimmed || trimmed.length > ID_MAX || /[\u0000-\u001f]/.test(trimmed)) {
		throw new Error(MEMORY_INVALID_FILTER);
	}
	return trimmed;
}

function parseConnectorId(value: string | null): string | undefined {
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

export const GET = withConnectorAccess("read", GETHandler);
