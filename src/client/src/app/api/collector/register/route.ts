import {
	upsertCollectorInstance,
	getCollectorConfig,
} from "@/lib/platform/collector";
import { getFirstDBConfig } from "@/lib/db-config";
import type { CollectorConfig } from "@/types/collector";

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const {
			instance_id,
			version,
			mode,
			node_name,
			listen_addr,
			external_url,
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
		const dbId = dbConfig.id;

		await upsertCollectorInstance(
			{
				instance_id,
				version: version || "",
				mode: mode || "linux",
				node_name: node_name || "",
				listen_addr: listen_addr || ":4321",
				external_url: external_url || "",
				status: "healthy",
				services_discovered: 0,
				services_instrumented: 0,
				last_heartbeat: new Date().toISOString(),
				created_at: new Date().toISOString(),
			},
			dbId
		);

		let config: CollectorConfig | null = null;
		const configRes = await getCollectorConfig(instance_id, dbId);
		if (configRes.data && configRes.data.length > 0 && configRes.data[0].config) {
			try {
				config = JSON.parse(configRes.data[0].config);
			} catch {
				// No valid config stored yet
			}
		}

		return Response.json({ config });
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Registration failed" },
			{ status: 500 }
		);
	}
}
