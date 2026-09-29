export const GOVERNANCE_SPAN_ID_MAX_LENGTH = 128;

const SPAN_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Validates span identifiers before governance queries. Rejects empty,
 * oversized, or injection-prone values while allowing standard OTel ids.
 */
export function validateGovernanceSpanId(spanId: string): string | null {
	const trimmed = String(spanId || "").trim();
	if (!trimmed || trimmed.length > GOVERNANCE_SPAN_ID_MAX_LENGTH) {
		return null;
	}
	if (!SPAN_ID_PATTERN.test(trimmed)) {
		return null;
	}
	return trimmed;
}
