import {
	getControllerInstances,
	getControllerConfig,
	saveControllerConfig,
} from "@/lib/platform/controller";
import {
	validateControllerConfig,
	ConfigValidationError,
} from "@/lib/platform/controller/validate-config";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const instanceId = searchParams.get("instance_id");

	if (!instanceId) {
		return Response.json(
			{ error: "instance_id query param required" },
			{ status: 400 }
		);
	}

	const res = await getControllerConfig(instanceId);
	if (res.err) {
		console.error("controller config error:", res.err);
		return Response.json({ error: "Failed to fetch config" }, { status: 500 });
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
		const { instance_id } = body as { instance_id?: string };

		if (body?.config === undefined || body?.config === null) {
			return Response.json({ error: "config is required" }, { status: 400 });
		}

		// The controller fetches and EXECUTES this config, and it is writable by
		// any authenticated user, so validate + sanitize it into a known bounded
		// shape before persisting. Reject hostile/malformed input outright.
		let config;
		try {
			config = validateControllerConfig(body.config);
		} catch (e) {
			if (e instanceof ConfigValidationError) {
				return Response.json({ error: `Invalid config: ${e.message}` }, { status: 400 });
			}
			throw e;
		}

		// Save config to ClickHouse. The controller will pick it up
		// on its next poll cycle (config hash will differ).
		if (instance_id) {
			await saveControllerConfig(instance_id, config);
			return Response.json({ status: "saved" });
		}

		// No instance_id: save to all known instances
		const instancesRes = await getControllerInstances();
		const instances = instancesRes.data || [];

		await Promise.allSettled(
			instances.map((inst) =>
				saveControllerConfig(inst.instance_id, config)
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
