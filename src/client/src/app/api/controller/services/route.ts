import { upsertServices } from "@/lib/platform/controller";
import { getFirstDBConfig } from "@/lib/db-config";

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const { instance_id, services } = body;

		if (!instance_id || !Array.isArray(services)) {
			return Response.json(
				{ error: "instance_id and services array required" },
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

		const rows = services.map((svc: any) => ({
			controller_instance_id: instance_id,
			service_name: svc.service_name || "",
			namespace: svc.namespace || "",
			language_runtime: svc.language_runtime || "",
			llm_providers: svc.llm_providers || [],
			open_ports: svc.open_ports || [],
			deployment_name: svc.deployment_name || "",
			pid: svc.pid || 0,
			exe_path: svc.exe_path || "",
			last_seen: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		}));

		await upsertServices(rows, dbConfig.id);

		return Response.json({ status: "ok", count: rows.length });
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Failed to upsert services" },
			{ status: 500 }
		);
	}
}
