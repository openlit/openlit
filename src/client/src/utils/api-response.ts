import { sanitizeErrorMessage } from "@/utils/validation";

export function errorResponse(
	err: unknown,
	fallback: string = "An unexpected error occurred",
	status: number = 400
): Response {
	return Response.json(sanitizeErrorMessage(err, fallback), { status });
}
