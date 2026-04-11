import {
	upsertControllerInstance,
	upsertServices,
	getControllerConfig,
	getPendingActions,
	markActionsAcknowledged,
	completeAction,
	getConfigHash,
	getServicesToReconcile,
	queueAction,
	getDesiredStatesForWorkloads,
} from "@/lib/platform/controller";
import { getFirstDBConfig } from "@/lib/db-config";
import type { ControllerConfig } from "@/types/controller";
import crypto from "crypto";

function deterministicServiceId(
	controllerInstanceId: string,
	workloadKey: string,
	namespace: string,
	serviceName: string
): string {
	const key = `${controllerInstanceId}:${workloadKey}:${namespace}:${serviceName}`;
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
			resource_attributes,
			cluster_id: rawClusterId,
		} = body;

		if (!instance_id) {
			return Response.json(
				{ error: "instance_id is required" },
				{ status: 400 }
			);
		}

		const clusterId = rawClusterId || "default";

		const dbConfig = await getFirstDBConfig();
		if (!dbConfig) {
			return Response.json(
				{ error: "No database configuration found. Complete onboarding first." },
				{ status: 503 }
			);
		}
		const dbId = dbConfig.id;

		const now = clickhouseNow();

		// 1. Upsert controller instance
		const instResult = await upsertControllerInstance(
			{
				instance_id,
				cluster_id: clusterId,
				version: version || "",
				mode: mode || "linux",
				node_name: node_name || "",
				status: "healthy",
				services_discovered: services_discovered || 0,
				services_instrumented: services_instrumented || 0,
				config_hash: config_hash || "",
				resource_attributes: resource_attributes || {},
				last_heartbeat: now,
			},
			dbId
		);
		if (instResult?.err) {
			console.error("controller poll: upsert instance error:", instResult.err);
		}

		// 2. Upsert discovered services — carry forward desired_* columns
		//    so the ReplacingMergeTree INSERT doesn't revert them to defaults
		const reportedServices: Array<{
			workload_key: string;
			instrumentation_status: string;
			resource_attributes?: Record<string, string>;
		}> = [];

		if (Array.isArray(services) && services.length > 0) {
			const workloadKeys = services
				.map((s: any) => s.workload_key)
				.filter(Boolean) as string[];
			const desiredRes = await getDesiredStatesForWorkloads(
				workloadKeys,
				clusterId,
				dbId
			);
			const desiredMap = new Map(
				(desiredRes.data || []).map((d) => [d.workload_key, d])
			);

			const rows = services.map((svc: any) => {
				if (!svc.workload_key) {
					throw new Error("controller poll: service is missing workload_key");
				}
				const ns = svc.namespace || "";
				const name = svc.service_name || "";
				const desired = desiredMap.get(svc.workload_key);

				reportedServices.push({
					workload_key: svc.workload_key,
					instrumentation_status: svc.instrumentation_status || "discovered",
					resource_attributes: svc.resource_attributes,
				});

				return {
					id: deterministicServiceId(instance_id, svc.workload_key, ns, name),
					controller_instance_id: instance_id,
					cluster_id: clusterId,
					service_name: name,
					workload_key: svc.workload_key,
					namespace: ns,
					language_runtime: svc.language_runtime || "",
					llm_providers: svc.llm_providers || [],
					open_ports: svc.open_ports || [],
					deployment_name: svc.deployment_name || "",
					pid: svc.pid || 0,
					exe_path: svc.exe_path || "",
					instrumentation_status: svc.instrumentation_status || "discovered",
					desired_instrumentation_status:
						(desired?.desired_instrumentation_status || "none") as
							"none" | "instrumented",
					desired_agent_status:
						(desired?.desired_agent_status || "none") as
							"none" | "enabled",
					resource_attributes: svc.resource_attributes || {},
					first_seen: svc.first_seen || now,
					last_seen: now,
					updated_at: now,
				};
			});
			const svcResult = await upsertServices(rows, dbId);
			if (svcResult?.err) {
				console.error("controller poll: upsert services error:", svcResult.err);
			}
		}

		// 3. Process action results from previous poll cycle
		if (Array.isArray(action_results)) {
			for (const ar of action_results) {
				if (ar.action_id && ar.status) {
					const completeResult = await completeAction(
						ar.action_id,
						instance_id,
						ar.status === "completed" ? "completed" : "failed",
						ar.error || "",
						dbId
					);
					if (completeResult?.err) {
						console.error(
							"controller poll: completeAction error:",
							completeResult.err
						);
					}
				}
			}
		}

		// 4. Reconciliation: compare desired vs. reported state and queue missing actions
		if (reportedServices.length > 0) {
			try {
				const reconcile = await getServicesToReconcile(
					instance_id,
					reportedServices,
					clusterId,
					dbId
				);
				for (const key of reconcile.instrumentKeys) {
					await queueAction(instance_id, "instrument", key, "{}", dbId);
				}
				for (const key of reconcile.uninstrumentKeys) {
					await queueAction(instance_id, "uninstrument", key, "{}", dbId);
				}
				for (const key of reconcile.enableAgentKeys) {
					await queueAction(
						instance_id,
						"enable_python_sdk",
						key,
						JSON.stringify({
							target_runtime: "python",
							instrumentation_profile: "controller_managed",
							duplicate_policy: "block_if_existing_otel_detected",
							observability_scope: "agent",
						}),
						dbId
					);
				}
				for (const key of reconcile.disableAgentKeys) {
					await queueAction(
						instance_id,
						"disable_python_sdk",
						key,
						JSON.stringify({
							target_runtime: "python",
							instrumentation_profile: "controller_managed",
							duplicate_policy: "block_if_existing_otel_detected",
							observability_scope: "agent",
						}),
						dbId
					);
				}
			} catch (reconcileErr) {
				console.error("controller poll: reconciliation error:", reconcileErr);
			}
		}

		// 5. Check if config has changed
		let configChanged = false;
		let config: ControllerConfig | null = null;
		let serverConfigHash = "";

		const configRes = await getControllerConfig(instance_id, dbId);
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

		// 6. Get pending actions and mark them acknowledged
		const actionsRes = await getPendingActions(instance_id, dbId);
		const pendingActions = actionsRes.data || [];

		if (pendingActions.length > 0) {
			const ackResult = await markActionsAcknowledged(pendingActions, instance_id, dbId);
			if (ackResult?.err) {
				console.error("controller poll: markActionsAcknowledged error:", ackResult.err);
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
		console.error("controller poll: unhandled error:", error);
		return Response.json(
			{ error: "Internal server error" },
			{ status: 500 }
		);
	}
}
