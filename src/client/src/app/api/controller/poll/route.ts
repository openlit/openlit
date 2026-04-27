import {
	upsertControllerInstance,
	upsertServices,
	getControllerConfig,
	getPendingActions,
	markActionsAcknowledged,
	completeAction,
	getConfigHash,
	queueAction,
	getFeatureDesiredStates,
	getEnvironmentFeatureConfigs,
} from "@/lib/platform/controller";
import { getAllFeatureHandlers } from "@/lib/platform/controller/features";
import type { ReportedService } from "@/lib/platform/controller/features";
import { getFirstDBConfig } from "@/lib/db-config";
import { getAPIKeyInfo, hasAnyAPIKeys } from "@/lib/platform/api-keys";
import type { ControllerConfig, FeatureDesiredState } from "@/types/controller";
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

function sanitizeLogValue(val: unknown): string {
	return String(val).replace(/[\r\n\t]/g, " ").slice(0, 500);
}

// --- Phase 1: Authentication ---

async function authenticatePollRequest(
	request: Request
): Promise<{ dbId: string } | Response> {
	const authHeader = request.headers.get("Authorization") || "";

	if (authHeader.startsWith("Bearer ")) {
		const apiKey = authHeader.replace(/^Bearer /, "").trim();
		if (!apiKey) {
			return Response.json(
				{ error: "Invalid API key" },
				{ status: 401 }
			);
		}
		const [keyErr, apiInfo] = await getAPIKeyInfo({ apiKey });
		if (keyErr || !apiInfo?.databaseConfigId) {
			return Response.json(
				{ error: "Invalid API key" },
				{ status: 401 }
			);
		}
		return { dbId: apiInfo.databaseConfigId };
	}

	const keysExist = await hasAnyAPIKeys();
	if (keysExist) {
		return Response.json(
			{
				error:
					"Authentication required. Set OPENLIT_API_KEY on your controller with a valid OpenLIT API key.",
			},
			{ status: 401 }
		);
	}

	const dbConfig = await getFirstDBConfig();
	if (!dbConfig) {
		return Response.json(
			{
				error:
					"No database configuration found. Complete onboarding first.",
			},
			{ status: 503 }
		);
	}
	return { dbId: dbConfig.id };
}

// --- Phase 2: Upsert instance ---

async function phaseUpsertInstance(
	body: any,
	now: string,
	dbId: string
) {
	const instResult = await upsertControllerInstance(
		{
			instance_id: body.instance_id,
			cluster_id: body.cluster_id,
			version: body.version || "",
			mode: body.mode || "linux",
			node_name: body.node_name || "",
			status: "healthy",
			services_discovered: body.services_discovered || 0,
			services_instrumented: body.services_instrumented || 0,
			config_hash: body.config_hash || "",
			resource_attributes: body.resource_attributes || {},
			last_heartbeat: now,
		},
		dbId
	);
	if (instResult?.err) {
		console.error(
			"controller poll: upsert instance error:",
			sanitizeLogValue(instResult.err)
		);
	}
}

// --- Phase 3: Upsert services ---

async function phaseUpsertServices(
	body: any,
	now: string,
	clusterId: string,
	dbId: string
): Promise<ReportedService[]> {
	const reportedServices: ReportedService[] = [];

	if (!Array.isArray(body.services) || body.services.length === 0) {
		return reportedServices;
	}

	const workloadKeys = body.services
		.map((s: any) => s.workload_key)
		.filter(Boolean) as string[];

	const desiredRes = await getFeatureDesiredStates(
		workloadKeys,
		clusterId,
		["instrumentation", "agent"],
		dbId
	);
	const desiredMap = new Map<string, { instr: string; agent: string }>();
	for (const d of desiredRes.data || []) {
		if (!desiredMap.has(d.workload_key)) {
			desiredMap.set(d.workload_key, { instr: "none", agent: "none" });
		}
		const entry = desiredMap.get(d.workload_key)!;
		if (d.feature === "instrumentation") entry.instr = d.desired_status;
		if (d.feature === "agent") entry.agent = d.desired_status;
	}

	const rows = body.services.map((svc: any) => {
		if (!svc.workload_key) {
			throw new Error(
				"controller poll: service is missing workload_key"
			);
		}
		const ns = svc.namespace || "";
		const name = svc.service_name || "";
		const desired = desiredMap.get(svc.workload_key);

		reportedServices.push({
			workload_key: svc.workload_key,
			instrumentation_status:
				svc.instrumentation_status || "discovered",
			resource_attributes: svc.resource_attributes,
		});

		return {
			id: deterministicServiceId(
				body.instance_id,
				svc.workload_key,
				ns,
				name
			),
			controller_instance_id: body.instance_id,
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
			instrumentation_status:
				svc.instrumentation_status || "discovered",
			desired_instrumentation_status: (desired?.instr || "none") as
				| "none"
				| "instrumented",
			desired_agent_status: (desired?.agent || "none") as
				| "none"
				| "enabled",
			resource_attributes: svc.resource_attributes || {},
			first_seen: svc.first_seen || now,
			last_seen: now,
			updated_at: now,
		};
	});

	const svcResult = await upsertServices(rows, dbId);
	if (svcResult?.err) {
		console.error(
			"controller poll: upsert services error:",
			sanitizeLogValue(svcResult.err)
		);
	}

	return reportedServices;
}

// --- Phase 4: Process action results ---

async function phaseProcessActionResults(
	actionResults: any[] | undefined,
	instanceId: string,
	dbId: string
) {
	if (!Array.isArray(actionResults)) return;
	for (const ar of actionResults) {
		if (ar.action_id && ar.status) {
			const completeResult = await completeAction(
				ar.action_id,
				instanceId,
				ar.status === "completed" ? "completed" : "failed",
				ar.error || "",
				dbId
			);
			if (completeResult?.err) {
				console.error("controller poll: completeAction failed");
			}
		}
	}
}

// --- Phase 5: Generic feature reconciliation ---

async function phaseReconcileAllFeatures(
	instanceId: string,
	reportedServices: ReportedService[],
	clusterId: string,
	environment: string,
	dbId: string
) {
	if (reportedServices.length === 0) return;

	const workloadKeys = reportedServices
		.map((s) => s.workload_key)
		.filter(Boolean);
	if (workloadKeys.length === 0) return;

	const handlers = getAllFeatureHandlers();

	const [desiredRes, envConfigRes] = await Promise.all([
		getFeatureDesiredStates(workloadKeys, clusterId, undefined, dbId),
		getEnvironmentFeatureConfigs(environment, clusterId, undefined, dbId),
	]);

	const desiredByFeature = new Map<
		string,
		Map<string, FeatureDesiredState>
	>();
	for (const d of desiredRes.data || []) {
		if (!desiredByFeature.has(d.feature)) {
			desiredByFeature.set(d.feature, new Map());
		}
		desiredByFeature.get(d.feature)!.set(d.workload_key, d);
	}

	const envConfigByFeature = new Map<string, any>();
	for (const ec of envConfigRes.data || []) {
		envConfigByFeature.set(ec.feature, ec);
	}

	for (const handler of handlers) {
		try {
			const featureDesired =
				desiredByFeature.get(handler.feature) || new Map();
			const featureEnvConfig = envConfigByFeature.get(handler.feature);
			const actions = handler.reconcile(
				reportedServices,
				featureDesired,
				featureEnvConfig
			);
			for (const action of actions) {
				await queueAction(
					instanceId,
					action.actionType,
					action.serviceKey,
					action.payload,
					dbId
				);
			}
		} catch (reconcileErr) {
			console.error(
				`controller poll: reconciliation error for feature "${handler.feature}":`,
				sanitizeLogValue(reconcileErr)
			);
		}
	}
}

// --- Phase 6: Config check ---

async function phaseCheckConfig(
	instanceId: string,
	clientConfigHash: string,
	dbId: string
): Promise<{
	configChanged: boolean;
	config: ControllerConfig | null;
	serverConfigHash: string;
}> {
	let configChanged = false;
	let config: ControllerConfig | null = null;
	let serverConfigHash = "";

	const configRes = await getControllerConfig(instanceId, dbId);
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
					!clientConfigHash ||
					clientConfigHash !== serverConfigHash;
			}
		} catch {
			// No valid config stored
		}
	}

	return { configChanged, config, serverConfigHash };
}

// --- Phase 7: Gather and acknowledge pending actions ---

async function phaseGatherActions(instanceId: string, dbId: string) {
	const actionsRes = await getPendingActions(instanceId, dbId);
	const pendingActions = actionsRes.data || [];

	if (pendingActions.length > 0) {
		const ackResult = await markActionsAcknowledged(
			pendingActions,
			instanceId,
			dbId
		);
		if (ackResult?.err) {
			console.error(
				"controller poll: markActionsAcknowledged error:",
				sanitizeLogValue(ackResult.err)
			);
		}
	}

	return pendingActions.map((a) => ({
		id: a.id,
		action_type: a.action_type,
		service_key: a.service_key,
		payload: a.payload,
	}));
}

// --- Main handler ---

export async function POST(request: Request) {
	try {
		const authResult = await authenticatePollRequest(request);
		if (authResult instanceof Response) return authResult;
		const { dbId } = authResult;

		const body = await request.json();
		if (!body.instance_id) {
			return Response.json(
				{ error: "instance_id is required" },
				{ status: 400 }
			);
		}

		const clusterId = body.cluster_id || "default";
		const now = clickhouseNow();

		await phaseUpsertInstance(body, now, dbId);

		const reportedServices = await phaseUpsertServices(
			body,
			now,
			clusterId,
			dbId
		);

		await phaseProcessActionResults(
			body.action_results,
			body.instance_id,
			dbId
		);

		await phaseReconcileAllFeatures(
			body.instance_id,
			reportedServices,
			clusterId,
			body.environment || "default",
			dbId
		);

		const { configChanged, config, serverConfigHash } =
			await phaseCheckConfig(
				body.instance_id,
				body.config_hash || "",
				dbId
			);

		const actions = await phaseGatherActions(body.instance_id, dbId);

		return Response.json({
			config_changed: configChanged,
			config: configChanged ? config : undefined,
			config_hash: serverConfigHash,
			actions,
		});
	} catch (error: any) {
		console.error(
			"controller poll: unhandled error:",
			sanitizeLogValue(error?.message || error)
		);
		return Response.json(
			{ error: "Internal server error" },
			{ status: 500 }
		);
	}
}
