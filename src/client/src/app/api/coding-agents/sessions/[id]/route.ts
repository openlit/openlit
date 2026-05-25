/**
 * GET /api/coding-agents/sessions/[id]
 *
 * Returns the per-session detail used by the Sessions tab drawer.
 * Cohort-floor enforcement happens inside `getSession`.
 */

import { NextRequest } from "next/server";
import {
	requireCodingAgentAuth,
	CodingAgentUnauthorizedError,
} from "@/lib/platform/coding-agents/auth";
import { getSession } from "@/lib/platform/coding-agents/queries";

export const dynamic = "force-dynamic";

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	let auth;
	try {
		auth = await requireCodingAgentAuth();
	} catch (err) {
		if (err instanceof CodingAgentUnauthorizedError) {
			return Response.json({ error: err.message }, { status: 401 });
		}
		throw err;
	}

	const { id } = await params;
	if (!id) {
		return Response.json({ error: "Missing session id" }, { status: 400 });
	}

	try {
		const detail = await getSession(auth, id);
		if (!detail) {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
		return Response.json({ data: detail });
	} catch (err) {
		console.error("coding_agent.sessions.detail_failed", err);
		return Response.json({ error: "Internal error" }, { status: 500 });
	}
}
