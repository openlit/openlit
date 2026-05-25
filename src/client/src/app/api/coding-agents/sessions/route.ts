/**
 * GET /api/coding-agents/sessions
 *
 * Read-only listing of recent coding-agent sessions, scoped to the
 * caller's current organisation and gated through requireCodingAgentAuth.
 * Mirrors the cursor + limit conventions used by /api/agents so the UI
 * can paginate identically.
 */

import {
	listSessions,
	type ListSessionsOptions,
} from "@/lib/platform/coding-agents/queries";
import {
	requireCodingAgentAuth,
	CodingAgentUnauthorizedError,
} from "@/lib/platform/coding-agents/auth";
import { isCodingAgentClassification } from "@/lib/platform/coding-agents/classifier";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	let auth;
	try {
		auth = await requireCodingAgentAuth();
	} catch (err) {
		if (err instanceof CodingAgentUnauthorizedError) {
			return Response.json({ error: err.message }, { status: 401 });
		}
		throw err;
	}

	const url = new URL(request.url);
	const sp = url.searchParams;

	const limitRaw = sp.get("limit");
	const limit = limitRaw ? Number(limitRaw) : undefined;
	if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
		return Response.json({ error: "Invalid limit" }, { status: 400 });
	}

	const cursor = sp.get("cursor");
	const vendor = sp.get("vendor");
	const classificationRaw = sp.get("classification");
	const sinceRaw = sp.get("since");
	const untilRaw = sp.get("until");

	const opts: ListSessionsOptions = {
		limit,
		cursor: cursor ?? null,
		vendor: vendor ?? null,
		classification: isCodingAgentClassification(classificationRaw)
			? classificationRaw
			: null,
		since: sinceRaw ? new Date(sinceRaw) : null,
		until: untilRaw ? new Date(untilRaw) : null,
	};

	try {
		const { rows, nextCursor } = await listSessions(auth, opts);
		return Response.json({
			data: rows,
			cursor: nextCursor,
		});
	} catch (err) {
		console.error("coding_agent.sessions.list_failed", err);
		return Response.json({ error: "Internal error" }, { status: 500 });
	}
}
