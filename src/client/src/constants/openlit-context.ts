export const OPENLIT_CONTEXT_HEADERS = {
	organisationId: "x-openlit-organisation-id",
	projectId: "x-openlit-project-id",
	databaseConfigId: "x-openlit-database-config-id",
	environment: "x-openlit-environment",
} as const;

export function getRequestEnvironment(request: Request): string | undefined {
	return request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) || undefined;
}
