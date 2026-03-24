import { sanitizeErrorMessage } from "@/utils/validation";

/**
 * Creates a sanitized error JSON response for API routes.
 * Prevents internal details (Prisma stack traces, ClickHouse errors, etc.) from leaking.
 */
export function errorResponse(
	err: unknown,
	fallback: string = "An unexpected error occurred",
	status: number = 400
): Response {
	return Response.json(sanitizeErrorMessage(err, fallback), { status });
}
