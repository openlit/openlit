import {
	getCollectorInstances,
	getCollectorConfig,
	saveCollectorConfig,
} from "@/lib/platform/collector";
import type { CollectorConfig } from "@/types/collector";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const instanceId = searchParams.get("instance_id");

	if (!instanceId) {
		return Response.json(
			{ error: "instance_id query param required" },
			{ status: 400 }
		);
	}

	const res = await getCollectorConfig(instanceId);
	if (res.err) {
		return Response.json({ error: res.err }, { status: 500 });
	}

	if (!res.data || res.data.length === 0) {
		return Response.json({ data: null });
	}

	try {
		const config = JSON.parse(res.data[0].config);
		return Response.json({ data: config });
	} catch {
		return Response.json({ data: null });
	}
}

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const { instance_id, config } = body as {
			instance_id?: string;
			config?: CollectorConfig;
		};

		if (!config) {
			return Response.json(
				{ error: "config is required" },
				{ status: 400 }
			);
		}

		// Save config to ClickHouse. The collector will pick it up
		// on its next poll cycle (config hash will differ).
		if (instance_id) {
			await saveCollectorConfig(instance_id, config);
			return Response.json({ status: "saved" });
		}

		// No instance_id: save to all known instances
		const instancesRes = await getCollectorInstances();
		const instances = instancesRes.data || [];

		await Promise.allSettled(
			instances.map((inst) =>
				saveCollectorConfig(inst.instance_id, config)
			)
		);

		return Response.json({
			status: "saved",
			instances: instances.length,
		});
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Config update failed" },
			{ status: 500 }
		);
	}
}
