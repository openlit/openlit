/**
 * Shared Authorization / tenant header construction for HTTP telemetry adapters.
 *
 * Grafana Cloud Tempo/Loki/Mimir query APIs use Basic auth
 * (instance ID + access policy token). Self-hosted LGTM often uses no auth,
 * Basic via a reverse proxy, or a Bearer token. Prefer Basic when a username is
 * present so Cloud configs win over a leftover bearer field.
 */
export function applyHttpAuthCredentials(
	credentials: Record<string, string>,
	opts?: { tenantHeader?: "X-Scope-OrgID" | "AccountID" }
): Record<string, string> {
	const headers: Record<string, string> = {};
	const username = credentials.username?.trim();
	const token = credentials.token?.trim();

	if (username) {
		const basic = Buffer.from(
			`${username}:${credentials.password || ""}`
		).toString("base64");
		headers.Authorization = `Basic ${basic}`;
	} else if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	const tenant = credentials.tenant?.trim();
	if (tenant && opts?.tenantHeader) {
		headers[opts.tenantHeader] = tenant;
	}

	return headers;
}
