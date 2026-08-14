/**
 * Validates and clamps a per-type threshold override. Returns undefined when
 * no value was provided (caller should fall back to the request/global
 * default), or NaN when a value was provided but isn't a usable number
 * (caller should reject the write).
 */
export function normalizeThresholdScore(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const numeric =
		typeof value === "number" ? value : Number.parseFloat(String(value));

	if (!Number.isFinite(numeric)) {
		return Number.NaN;
	}
	if (numeric < 0) return 0;
	if (numeric > 1) return 1;
	return numeric;
}
