export function getErrorMessage(error: unknown, fallback = "Request failed") {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return fallback;
}

export function errorResponse(
	error: unknown,
	status = 400,
	extra: Record<string, unknown> = {}
) {
	const message = getErrorMessage(error);
	return Response.json({ error: message, err: message, ...extra }, { status });
}
