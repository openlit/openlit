import { getDBConfigByUser, upsertDBConfig } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import { DatabaseConfig } from "@prisma/client";
import { sanitizeErrorMessage } from "@/utils/validation";

function stripSensitiveDbFields(config: any) {
	if (!config) return config;
	const { password, ...rest } = config;
	return { ...rest, password: password ? "****" : "" };
}

export async function GET() {
	const [err, res]: any = await asaw(getDBConfigByUser());
	if (err)
		return Response.json("Failed to fetch database configurations", {
			status: 400,
		});

	// Strip passwords from response
	const sanitized = Array.isArray(res)
		? res.map(stripSensitiveDbFields)
		: stripSensitiveDbFields(res);

	return Response.json(sanitized);
}

export async function POST(request: Request) {
	const formData = await request.json();
	const id = formData.id;

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
		return Response.json(sanitizeErrorMessage(err, "Failed to save database configuration"), {
			status: 400,
		});

	return Response.json(res);
}
