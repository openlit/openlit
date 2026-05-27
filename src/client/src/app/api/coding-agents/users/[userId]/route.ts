/**
 * GET /api/coding-agents/users/[userId]
 *
 * Header card for the per-user page. Returns a compact digest scoped to
 * one developer (sessions, tools, cost, work/personal mix, top
 * vendors). Respects `COHORT_K_FLOOR`: if the requested user has fewer
 * than the floor's worth of sessions and the caller is not an admin we
 * 404 — the page is meaningless without enough data and the cohort
 * floor is the privacy seal we promise viewer-tier callers.
 */

import {
	requireCodingAgentAuth,
	CodingAgentUnauthorizedError,
} from "@/lib/platform/coding-agents/auth";
import { getCodingUserDigest } from "@/lib/platform/coding-agents/queries";

export const dynamic = "force-dynamic";

export async function GET(
	request: Request,
	context: { params: { userId: string } }
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

	const userId = decodeURIComponent(context.params.userId || "").trim();
	if (!userId) {
		return Response.json({ error: "Missing userId" }, { status: 400 });
	}
	if (userId === "low_cohort") {
		// `low_cohort` is the masked sentinel — we reject it explicitly
		// rather than letting the helper return 0 sessions and 404 (the
		// 400 makes the failure mode obvious in logs).
		return Response.json(
			{ error: "Cannot drill into the masked low-cohort bucket." },
			{ status: 400 }
		);
	}

	const url = new URL(request.url);
	const since = url.searchParams.get("since");
	const until = url.searchParams.get("until");

	try {
		const digest = await getCodingUserDigest(auth, userId, {
			since: since ? new Date(since) : null,
			until: until ? new Date(until) : null,
		});
		if (!digest) {
			return Response.json(
				{ error: "Not found or below cohort floor." },
				{ status: 404 }
			);
		}
		return Response.json({ data: digest });
	} catch (err) {
		console.error("coding_agent.user.digest_failed", err);
		return Response.json({ error: "Internal error" }, { status: 500 });
	}
}
