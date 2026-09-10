import { withAudit } from "@/lib/audit/route";
import {
	requireCurrentOrganisationPermission,
	withCurrentOrganisationPermission,
} from "@/lib/rbac/current";
import {
	getDBConfigByIdInternal,
	getDBConfigByUser,
	upsertDBConfig,
} from "@/lib/db-config";
import asaw from "@/utils/asaw";
import { DatabaseConfig } from "@prisma/client";
import { errorResponse } from "@/utils/api-response";
import { createProjectEnvironment } from "@/lib/project-environment";
import { MIDDLEWARE_DATABASE_CONFIG_HEADER } from "@/constants/openlit-context";

function stripSensitiveDbFields(config: any) {
	if (!config) return config;

	const { password, ...rest } = config;
	return { ...rest, password: password ? "****" : "" };
}

async function GETHandler(request: Request) {
	const apiKeyDatabaseConfigId =
		request.headers?.get?.(MIDDLEWARE_DATABASE_CONFIG_HEADER)?.trim() ||
		undefined;

	if (apiKeyDatabaseConfigId) {
		const [err, config]: any = await asaw(
			getDBConfigByIdInternal({ id: apiKeyDatabaseConfigId })
		);
		if (err) {
			return errorResponse(err, "Failed to fetch database configurations");
		}
		return Response.json(config ? [stripSensitiveDbFields(config)] : []);
	}

	const [err, res]: any = await asaw(getDBConfigByUser());
	if (err)
		return errorResponse(err, "Failed to fetch database configurations");

	const sanitized = Array.isArray(res)
		? res.map(stripSensitiveDbFields)
		: stripSensitiveDbFields(res);

	return Response.json(sanitized);
}

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const id = formData.id;
	const apiKeyDatabaseConfigId =
		request.headers?.get?.(MIDDLEWARE_DATABASE_CONFIG_HEADER)?.trim() ||
		undefined;

	if (!apiKeyDatabaseConfigId) {
		const requiredPermission = id ? "db_config:update" : "db_config:create";
		const [permissionErr] = await asaw(
			requireCurrentOrganisationPermission(requiredPermission)
		);
		if (permissionErr) return errorResponse(permissionErr, "Forbidden", 403);
	}

	const dbConfig: Partial<DatabaseConfig> = {
		name: formData.name,
		environment: formData.environment,
		username: formData.username,
		password: formData.password,
		host: formData.host,
		port: formData.port,
		database: formData.database,
		query: formData.query,
	};

	const [err, res]: any = await asaw(upsertDBConfig(dbConfig, id));

	if (err) {
		console.error("[api/db-config] save failed", {
			id: id || null,
			name: formData.name,
			environment: formData.environment,
			host: formData.host,
			port: formData.port,
			error: err,
		});
		return errorResponse(err, "Failed to save database configuration");
	}

	if (formData.environment) await createProjectEnvironment(formData.environment);
	return Response.json(res);
}

export const GET = withCurrentOrganisationPermission(
	"db_config:read",
	GETHandler
);
export const POST = withAudit(POSTHandler);
