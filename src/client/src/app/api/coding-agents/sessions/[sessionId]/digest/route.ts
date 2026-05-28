/**
 * GET /api/coding-agents/sessions/[sessionId]/digest
 *
 * Tiny rollup endpoint consumed by the trace-detail header pills
 * (Lines added / Lines deleted / Commits / Acceptance / PRs) so the
 * pills stay populated regardless of which span inside the session
 * the operator clicked into. The session-rollup attributes only
 * live on the session-root span at SessionEnd; this endpoint runs a
 * single grouped query against `otel_traces` to fold them up by
 * `chat_id` (= parent ?? session_id) so the same totals appear for
 * every span in the same chat thread.
 *
 * Kept narrow on purpose — the full session join (turns, tool
 * calls, MCP, edit decisions) is overkill when the pill row only
 * needs the seven counters. Gated through `requireCodingAgentAuth`,
 * and `getCodingSessionDigest` enforces the same COHORT_K_FLOOR
 * floor as the per-user page for non-admin viewers — a known
 * session_id should not become a side channel for low-volume
 * users' aggregate metrics.
 */

import {
	requireCodingAgentAuth,
	CodingAgentUnauthorizedError,
} from "@/lib/platform/coding-agents/auth";
import { getCodingSessionDigest } from "@/lib/platform/coding-agents/queries";

export const dynamic = "force-dynamic";

export async function GET(
	_request: Request,
	context: { params: { sessionId: string } },
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

	const sessionId = decodeURIComponent(context.params.sessionId || "").trim();
	if (!sessionId) {
		return Response.json({ error: "Missing sessionId" }, { status: 400 });
	}

	try {
		const digest = await getCodingSessionDigest(auth, sessionId);
		if (!digest) {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
		return Response.json({ data: digest });
	} catch (err) {
		console.error("coding_agent.session.digest_failed", err);
		return Response.json({ error: "Internal error" }, { status: 500 });
	}
}
