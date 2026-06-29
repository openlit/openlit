/**
 * Personal-vs-work classification metadata + UI helpers.
 *
 * The classification itself is stamped on every coding-agent span at
 * hook-time by the openlit CLI (see `cli/internal/coding/classify`).
 * This module exposes:
 *
 *   - The canonical enum values, so UI components, queries, and tests
 *     stay in sync with the CLI.
 *   - Human-readable labels for the Governance board.
 *   - The shape of the dispute payload submitted via the API.
 *
 * No ClickHouse access lives here — that's `queries.ts`. No prisma
 * access either — those reads happen behind the API route to keep
 * this file safe to import from the client (e.g. for badge labels).
 */

export type CodingAgentClassification =
	| "personal"
	| "work"
	| "disputed"
	| "unknown";

export type CodingAgentClassificationReason =
	| "api_key_allowlist"
	| "repo_origin_allowlist"
	| "repo_origin_blocklist"
	| "user_dispute"
	| "no_signal";

export const CODING_AGENT_CLASSIFICATION_LABELS: Record<
	CodingAgentClassification,
	string
> = {
	personal: "Personal",
	work: "Work",
	disputed: "Disputed",
	unknown: "Unknown",
};

export const CODING_AGENT_CLASSIFICATION_DESCRIPTIONS: Record<
	CodingAgentClassification,
	string
> = {
	personal:
		"Session originated outside the org's API-key/repo allowlist. Not counted in work spend.",
	work:
		"Session matched the API-key allowlist or a repo on an allowlisted origin.",
	disputed:
		"User filed a dispute on the auto-classification. Awaiting admin review.",
	unknown:
		"No classification signal was available — usually because the CLI ran without an API key or in a fresh repo.",
};

export const CODING_AGENT_CLASSIFICATION_REASON_LABELS: Record<
	CodingAgentClassificationReason,
	string
> = {
	api_key_allowlist: "Matched an API key on the org allowlist",
	repo_origin_allowlist: "Repository origin is on the org allowlist",
	repo_origin_blocklist: "Repository origin is on the org blocklist",
	user_dispute: "Reclassified by user via dispute",
	no_signal: "No classification signal available",
};

export interface CodingAgentClassificationDispute {
	sessionId: string;
	currentClassification: CodingAgentClassification;
	requestedClassification: CodingAgentClassification;
	rationale: string;
}

/**
 * Validate a dispute payload before we persist it. Returns an error
 * string if invalid; null otherwise. Kept synchronous so it can be
 * reused on the client for form-level validation.
 */
export function validateClassificationDispute(
	input: Partial<CodingAgentClassificationDispute>
): string | null {
	if (!input.sessionId || typeof input.sessionId !== "string") {
		return "sessionId is required.";
	}
	if (
		!input.currentClassification ||
		!isCodingAgentClassification(input.currentClassification)
	) {
		return "currentClassification is invalid.";
	}
	if (
		!input.requestedClassification ||
		!isCodingAgentClassification(input.requestedClassification)
	) {
		return "requestedClassification is invalid.";
	}
	if (input.requestedClassification === input.currentClassification) {
		return "Requested classification must differ from the current one.";
	}
	if (input.requestedClassification === "disputed") {
		return "Cannot dispute toward 'disputed' — choose work, personal, or unknown.";
	}
	if (typeof input.rationale !== "string" || input.rationale.trim().length < 4) {
		return "A short rationale (at least 4 characters) is required.";
	}
	if (input.rationale.length > 1000) {
		return "Rationale must be 1000 characters or fewer.";
	}
	return null;
}

export function isCodingAgentClassification(
	value: unknown
): value is CodingAgentClassification {
	return (
		value === "personal" ||
		value === "work" ||
		value === "disputed" ||
		value === "unknown"
	);
}
