import { upsertControllerInstance } from "@/lib/platform/controller";
import { getFirstDBConfig } from "@/lib/db-config";

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const {
			instance_id,
			services_discovered,
			services_instrumented,
			config_hash,
		} = body;

		if (!instance_id) {
			return Response.json(
				{ error: "instance_id is required" },
				{ status: 400 }
			);
		}

		const dbConfig = await getFirstDBConfig();
		if (!dbConfig) {
			return Response.json(
				{ error: "No database configuration found" },
				{ status: 503 }
			);
		}

		await upsertControllerInstance(
			{
				instance_id,
				status: "healthy",
				services_discovered: services_discovered || 0,
				services_instrumented: services_instrumented || 0,
				config_hash: config_hash || "",
				last_heartbeat: new Date().toISOString(),
			},
			dbConfig.id
		);

		return Response.json({ status: "ok" });
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Heartbeat failed" },
			{ status: 500 }
		);
	}
}
