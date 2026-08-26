/**
 * Compatibility helpers for legacy `/api/observability/*` twins.
 * Prefer `/api/telemetry/*`. These routes keep `observability.read` auth while
 * marking responses deprecated toward the telemetry successors.
 */

export function deprecatedObservabilityResponse(
	response: Response,
	successorPath: string
): Response {
	const headers = new Headers(response.headers);
	headers.set("Deprecation", "true");
	headers.set("Link", `<${successorPath}>; rel="successor-version"`);
	headers.set("X-OpenLIT-Deprecated-Alias", "observability→telemetry");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export async function jsonWithObservabilityDeprecation(
	body: unknown,
	successorPath: string,
	init?: ResponseInit
): Promise<Response> {
	return deprecatedObservabilityResponse(
		Response.json(body, init),
		successorPath
	);
}
