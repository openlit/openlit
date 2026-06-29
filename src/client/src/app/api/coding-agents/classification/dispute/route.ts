/**
 * POST /api/coding-agents/classification/dispute
 *
 * User submits a classification dispute on a coding-agent session.
 * The action is audit-logged regardless of payload validity (the
 * audit row records "rejected_invalid" when the payload fails
 * validation, so attempts at probing the API are visible to admins).
 *
 * Members can file disputes; only admins resolve them via a separate
 * endpoint we'll add in v1.1. The API returns 202 (Accepted) so the
 * UI doesn't claim definitive change of state.
 */

import {
	requireCodingAgentAuth,
	CodingAgentUnauthorizedError,
} from "@/lib/platform/coding-agents/auth";
import {
	DisputeError,
	submitClassificationDispute,
	writeAuditLog,
} from "@/lib/platform/coding-agents/queries";
import {
	validateClassificationDispute,
	type CodingAgentClassificationDispute,
} from "@/lib/platform/coding-agents/classifier";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	let auth;
	try {
		auth = await requireCodingAgentAuth();
	} catch (err) {
		if (err instanceof CodingAgentUnauthorizedError) {
			return Response.json({ error: err.message }, { status: 401 });
		}
		throw err;
	}

	let body: Partial<CodingAgentClassificationDispute>;
	try {
		body = (await request.json()) as Partial<CodingAgentClassificationDispute>;
	} catch {
		await writeAuditLog(auth, {
			action: "coding_agent.classification.dispute.rejected_invalid",
			subject: "",
			payload: "malformed_json",
		});
		return Response.json({ error: "Malformed JSON" }, { status: 400 });
	}

	const validationError = validateClassificationDispute(body);
	if (validationError) {
		await writeAuditLog(auth, {
			action: "coding_agent.classification.dispute.rejected_invalid",
			subject: body?.sessionId || "",
			payload: validationError,
		});
		return Response.json({ error: validationError }, { status: 400 });
	}

	try {
		const result = await submitClassificationDispute(
			auth,
			body as CodingAgentClassificationDispute
		);
		return Response.json({ data: result }, { status: 202 });
	} catch (err) {
		// E4: surface validation-grade errors with their intended
		// HTTP status (404 not_found, 409 duplicate, 429
		// rate_limited). Anything else stays a 500.
		if (err instanceof DisputeError) {
			await writeAuditLog(auth, {
				action: `coding_agent.classification.dispute.rejected_${err.code}`,
				subject: body?.sessionId || "",
				payload: err.message,
			});
			return Response.json({ error: err.message }, { status: err.status });
		}
		console.error("coding_agent.classification.dispute.failed", err);
		return Response.json({ error: "Internal error" }, { status: 500 });
	}
}
