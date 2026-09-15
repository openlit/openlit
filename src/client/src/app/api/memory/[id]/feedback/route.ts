import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withMemoryAccess, withMemoryAudit } from "@/lib/access/memory-route";
import { isMemoryConnectorId, memoryConnectorId } from "@/lib/platform/connectors/memory/crud";
import { submitProjectMemoryFeedback } from "@/lib/platform/connectors/memory/read";
import { isMemoryFeedbackRating } from "@/lib/platform/connectors/memory/types";
import {
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_DETAIL_FEEDBACK_SAVE_FAILED,
	MEMORY_DETAIL_FEEDBACK_UNSUPPORTED,
	MEMORY_DETAIL_NOT_FOUND,
	MEMORY_FEEDBACK_INVALID,
	MEMORY_FEEDBACK_REASON_TOO_LONG,
	MEMORY_INVALID_FILTER,
	MEMORY_INVALID_JSON,
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

async function POSTHandler(
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

	const rating = body.rating === null || body.rating === "" ? null : body.rating;
	if (rating !== null && !isMemoryFeedbackRating(rating)) {
		return errorResponse(MEMORY_FEEDBACK_INVALID, MEMORY_FEEDBACK_INVALID, 400);
	}
	if (typeof body.reason === "string" && body.reason.length > 1000) {
		return errorResponse(
			MEMORY_FEEDBACK_REASON_TOO_LONG,
			MEMORY_FEEDBACK_REASON_TOO_LONG,
			400
		);
	}

	const [err, result] = await asaw(
		submitProjectMemoryFeedback({
			id,
			connectorId,
			rating,
			reason: typeof body.reason === "string" ? body.reason : body.reason === null ? null : undefined,
		})
	);
	if (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status =
			message === MEMORY_DETAIL_NOT_FOUND || message === MEMORY_CONNECTOR_NOT_FOUND
				? 404
				: message === MEMORY_DETAIL_FEEDBACK_UNSUPPORTED
					? 400
					: 400;
		return errorResponse(err, MEMORY_DETAIL_FEEDBACK_SAVE_FAILED, status);
	}
	return Response.json(result);
}

export const POST = withMemoryAudit(withMemoryAccess("feedback", POSTHandler));
