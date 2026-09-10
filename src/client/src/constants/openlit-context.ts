export const OPENLIT_CONTEXT_HEADERS = {
	organisationId: "x-openlit-organisation-id",
	projectId: "x-openlit-project-id",
	databaseConfigId: "x-openlit-database-config-id",
	environment: "x-openlit-environment",
} as const;

/** Middleware injects this after a successful Bearer API key verification. */
export const MIDDLEWARE_DATABASE_CONFIG_HEADER = "x-database-config-id";

export function getRequestEnvironment(request: Request): string | undefined {
	return request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) || undefined;
}
