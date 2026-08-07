/**
 * Normalize user-supplied datasource endpoint URLs before persist/fetch.
 *
 * Browsers and paste paths sometimes collapse `http://host` into `http:/host`
 * (single slash). `URL` can still parse that, but we store the canonical form.
 */

/** Fix `http:/host` / `https:/host` and trim trailing slashes. */
export function normalizeDatasourceEndpointUrl(raw: string): string {
	const trimmed = String(raw || "").trim();
	if (!trimmed) return trimmed;
	const withAuthority = trimmed.replace(/^(https?:)\/(?!\/)/i, "$1//");
	try {
		const url = new URL(withAuthority);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return withAuthority.replace(/\/+$/, "");
		}
		return url.toString().replace(/\/+$/, "");
	} catch {
		return withAuthority.replace(/\/+$/, "");
	}
}

/** True for checkbox / switch values that mean enabled. */
export function isEnabledSetting(value: unknown): boolean {
	return value === true || value === "true" || value === 1 || value === "1";
}
