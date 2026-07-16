import { getCurrentUser } from "@/lib/session";

/**
 * Resolves the database configuration ID from the request headers or the current user session.
 * Returns a tuple of [error, databaseConfigId].
 */
export async function resolveDbConfigId(request: Request): Promise<[string | null, string | undefined]> {
	const dbConfigId = request.headers.get("x-database-config-id");
	if (dbConfigId) {
		return [null, dbConfigId];
	}

	const user = await getCurrentUser();
	if (!user) {
		return ["Unauthorized", undefined];
	}

	return [null, undefined];
}
