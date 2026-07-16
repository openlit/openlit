import { withAudit } from "@/lib/audit/route";
import { requireCurrentOrganisationPermission } from "@/lib/rbac/current";
import { getDBConfigByUser, upsertDBConfig } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import { DatabaseConfig } from "@prisma/client";
import { errorResponse } from "@/utils/api-response";

function stripSensitiveDbFields(config: any) {
	if (!config) return config;

	const { password, ...rest } = config;
	return { ...rest, password: password ? "****" : "" };
}

export async function GET() {
	const [permissionErr] = await asaw(
		requireCurrentOrganisationPermission("db_config:read")
	);
	if (permissionErr) return errorResponse(permissionErr, "Forbidden", 403);

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
	const requiredPermission = id ? "db_config:update" : "db_config:create" as const;

	const [permissionErr] = await asaw(
		requireCurrentOrganisationPermission(requiredPermission)
	);
	if (permissionErr) return errorResponse(permissionErr, "Forbidden", 403);

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

	if (err)
		return errorResponse(err, "Failed to save database configuration");

	return Response.json(res);
}

export const POST = withAudit(POSTHandler);
