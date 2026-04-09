import {
	upsertCollectorInstance,
	upsertServices,
	getCollectorConfig,
	getPendingActions,
	markActionsAcknowledged,
	completeAction,
	getConfigHash,
} from "@/lib/platform/collector";
import { getFirstDBConfig } from "@/lib/db-config";
import type { CollectorConfig } from "@/types/collector";
import crypto from "crypto";

function deterministicServiceId(
	collectorInstanceId: string,
	namespace: string,
	serviceName: string
): string {
	const key = `${collectorInstanceId}:${namespace}:${serviceName}`;
	const hash = crypto.createHash("md5").update(key).digest("hex");
	return [
		hash.slice(0, 8),
		hash.slice(8, 12),
		hash.slice(12, 16),
		hash.slice(16, 20),
		hash.slice(20, 32),
	].join("-");
}

function clickhouseNow(): string {
	return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const {
			instance_id,
			version,
			mode,
			node_name,
			config_hash,
			services_discovered,
			services_instrumented,
			services,
			action_results,
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
				{ error: "No database configuration found. Complete onboarding first." },
				{ status: 503 }
			);
		}
		const dbId = dbConfig.id;

		const now = clickhouseNow();

		// 1. Upsert collector instance (acts as register + heartbeat)
		const instResult = await upsertCollectorInstance(
			{
				instance_id,
				version: version || "",
				mode: mode || "linux",
				node_name: node_name || "",
				status: "healthy",
				services_discovered: services_discovered || 0,
				services_instrumented: services_instrumented || 0,
				config_hash: config_hash || "",
				last_heartbeat: now,
			},
			dbId
		);
		if (instResult?.err) {
			console.error("collector poll: upsert instance error:", instResult.err);
		}

		// 2. Upsert discovered services
		if (Array.isArray(services) && services.length > 0) {
			const rows = services.map((svc: any) => {
				const ns = svc.namespace || "";
				const name = svc.service_name || "";
				return {
					id: deterministicServiceId(instance_id, ns, name),
					collector_instance_id: instance_id,
					service_name: name,
					namespace: ns,
					language_runtime: svc.language_runtime || "",
					llm_providers: svc.llm_providers || [],
					open_ports: svc.open_ports || [],
					deployment_name: svc.deployment_name || "",
					pid: svc.pid || 0,
					exe_path: svc.exe_path || "",
					instrumentation_status: svc.instrumentation_status || "discovered",
					last_seen: now,
					updated_at: now,
				};
			});
			const svcResult = await upsertServices(rows, dbId);
			if (svcResult?.err) {
				console.error("collector poll: upsert services error:", svcResult.err);
			}
		}

		// 3. Process action results from previous poll cycle
		if (Array.isArray(action_results)) {
			for (const ar of action_results) {
				if (ar.action_id && ar.status) {
					await completeAction(
						ar.action_id,
						instance_id,
						ar.status === "completed" ? "completed" : "failed",
						ar.error || "",
						dbId
					);
				}
			}
		}

		// 4. Check if config has changed
		let configChanged = false;
		let config: CollectorConfig | null = null;
		let serverConfigHash = "";

		const configRes = await getCollectorConfig(instance_id, dbId);
		if (
			configRes.data &&
			configRes.data.length > 0 &&
			configRes.data[0].config
		) {
			try {
				config = JSON.parse(configRes.data[0].config);
				if (config) {
					serverConfigHash = getConfigHash(config);
					configChanged =
						!config_hash || config_hash !== serverConfigHash;
				}
			} catch {
				// No valid config stored
			}
		}

		// 5. Get pending actions and mark them acknowledged
		const actionsRes = await getPendingActions(instance_id, dbId);
		const pendingActions = actionsRes.data || [];

		if (pendingActions.length > 0) {
			const ackResult = await markActionsAcknowledged(pendingActions, instance_id, dbId);
			if (ackResult?.err) {
				console.error("collector poll: markActionsAcknowledged error:", ackResult.err);
			}
		}

		const actions = pendingActions.map((a) => ({
			id: a.id,
			action_type: a.action_type,
			service_key: a.service_key,
			payload: a.payload,
		}));

		return Response.json({
			config_changed: configChanged,
			config: configChanged ? config : undefined,
			config_hash: serverConfigHash,
			actions,
		});
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Poll failed" },
			{ status: 500 }
		);
	}
}
