import { dataCollector } from "@/lib/platform/common";
import {
	CONTROLLER_SERVICES_TABLE,
	CONTROLLER_INSTANCES_TABLE,
	CONTROLLER_CONFIG_TABLE,
	CONTROLLER_ACTIONS_TABLE,
	CONTROLLER_DESIRED_STATES_V2_TABLE,
	CONTROLLER_ENV_CONFIGS_TABLE,
} from "./table-details";
import type {
	ControllerConfig,
	ControllerInstance,
	ControllerService,
	ActionType,
	ActionStatus,
	PendingAction,
	FeatureDesiredState,
	EnvironmentFeatureConfig,
} from "@/types/controller";
import crypto from "crypto";

function clickhouseNow(): string {
	return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function escapeClickHouse(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// --- ClickHouse queries (OpenLIT dashboard reads/writes) ---

export async function getControllerInstances(
	dbConfigId?: string
): Promise<{ err?: unknown; data?: ControllerInstance[] }> {
	const query = `
		SELECT *
		FROM ${CONTROLLER_INSTANCES_TABLE}
		FINAL
		ORDER BY last_heartbeat DESC
		LIMIT 100
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: ControllerInstance[];
	}>;
}

export async function getControllerInstanceById(
	instanceId: string,
	dbConfigId?: string
): Promise<{ err?: unknown; data?: ControllerInstance[] }> {
	const query = `
		SELECT *
		FROM ${CONTROLLER_INSTANCES_TABLE}
		FINAL
		WHERE instance_id = '${instanceId}'
		LIMIT 1
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: ControllerInstance[];
	}>;
}

export async function upsertControllerInstance(
	instance: Partial<ControllerInstance>,
	dbConfigId?: string
) {
	return dataCollector(
		{
			table: CONTROLLER_INSTANCES_TABLE,
			values: [instance],
		},
		"insert",
		dbConfigId
	);
}

export async function getDiscoveredServices(
	timeStart?: string,
	timeEnd?: string,
	dbConfigId?: string
): Promise<{ err?: unknown; data?: ControllerService[] }> {
	const tbl = CONTROLLER_SERVICES_TABLE;
	const actionTbl = CONTROLLER_ACTIONS_TABLE;
	let timeFilter = "";
	if (timeStart && timeEnd) {
		timeFilter = `WHERE ${tbl}.last_seen >= '${timeStart}' AND ${tbl}.last_seen <= '${timeEnd}'`;
	}
	const desiredTbl = CONTROLLER_DESIRED_STATES_V2_TABLE;
	const query = `
		WITH aggregated_services AS (
			SELECT
				argMax(s.id, s.last_seen) AS id,
				argMax(s.controller_instance_id, s.last_seen) AS controller_instance_id,
				argMax(s.cluster_id, s.last_seen) AS cluster_id,
				argMax(s.service_name, s.last_seen) AS service_name,
				argMax(s.workload_key, s.last_seen) AS workload_key,
				argMax(s.namespace, s.last_seen) AS namespace,
				argMax(s.language_runtime, s.last_seen) AS language_runtime,
				arrayDistinct(arrayFlatten(groupArray(s.llm_providers))) AS llm_providers,
				argMax(s.open_ports, s.last_seen) AS open_ports,
				argMax(s.deployment_name, s.last_seen) AS deployment_name,
				argMax(s.pid, s.last_seen) AS pid,
				argMax(s.exe_path, s.last_seen) AS exe_path,
				argMax(s.instrumentation_status, s.last_seen) AS instrumentation_status,
				argMax(s.resource_attributes, s.last_seen) AS resource_attributes,
				min(s.first_seen) AS first_seen,
				max(s.last_seen) AS last_seen,
				max(s.updated_at) AS updated_at
			FROM (
				SELECT
					*,
					concat(cluster_id, ':', if(deployment_name != '', concat(namespace, ':', deployment_name), concat(namespace, ':', service_name))) AS group_key
				FROM ${tbl}
				FINAL
				${timeFilter}
			) AS s
			GROUP BY s.group_key
		),
		desired_states AS (
			SELECT
				workload_key,
				cluster_id,
				max(if(feature = 'instrumentation', desired_status, '')) AS desired_instrumentation_status,
				max(if(feature = 'agent', desired_status, '')) AS desired_agent_status
			FROM ${desiredTbl}
			FINAL
			GROUP BY workload_key, cluster_id
		),
		active_actions AS (
			SELECT
				instance_id,
				service_key,
				CAST(argMax(action_type, updated_at), 'Nullable(String)') AS pending_action,
				CAST(argMax(status, updated_at), 'Nullable(String)') AS pending_action_status,
				max(updated_at) AS pending_action_updated_at
			FROM ${actionTbl}
			FINAL
			WHERE status IN ('pending', 'acknowledged')
			  AND updated_at >= now() - INTERVAL 15 SECOND
			GROUP BY instance_id, service_key
		),
		failed_actions AS (
			SELECT
				instance_id,
				service_key,
				CAST(argMax(action_type, updated_at), 'Nullable(String)') AS last_error_action,
				CAST(argMax(result, updated_at), 'Nullable(String)') AS last_error,
				max(updated_at) AS failed_at
			FROM ${actionTbl}
			FINAL
			WHERE status = 'failed'
			  AND updated_at >= now() - INTERVAL 60 SECOND
			GROUP BY instance_id, service_key
		)
		SELECT
			aggregated_services.id AS id,
			aggregated_services.controller_instance_id AS controller_instance_id,
			aggregated_services.cluster_id AS cluster_id,
			aggregated_services.service_name AS service_name,
			aggregated_services.workload_key AS workload_key,
			aggregated_services.namespace AS namespace,
			aggregated_services.language_runtime AS language_runtime,
			aggregated_services.llm_providers AS llm_providers,
			aggregated_services.open_ports AS open_ports,
			aggregated_services.deployment_name AS deployment_name,
			aggregated_services.pid AS pid,
			aggregated_services.exe_path AS exe_path,
			aggregated_services.instrumentation_status AS instrumentation_status,
			aggregated_services.resource_attributes AS resource_attributes,
			aggregated_services.first_seen AS first_seen,
			aggregated_services.last_seen AS last_seen,
			aggregated_services.updated_at AS updated_at,
			if(desired_states.desired_instrumentation_status = '' OR isNull(desired_states.desired_instrumentation_status), 'none', desired_states.desired_instrumentation_status) AS desired_instrumentation_status,
			if(desired_states.desired_agent_status = '' OR isNull(desired_states.desired_agent_status), 'none', desired_states.desired_agent_status) AS desired_agent_status,
			if(
				isNull(active_actions.pending_action_updated_at) OR
					active_actions.pending_action_updated_at < aggregated_services.updated_at,
				CAST(NULL, 'Nullable(String)'),
				active_actions.pending_action
			) AS pending_action,
			if(
				isNull(active_actions.pending_action_updated_at) OR
					active_actions.pending_action_updated_at < aggregated_services.updated_at,
				CAST(NULL, 'Nullable(String)'),
				active_actions.pending_action_status
			) AS pending_action_status,
			failed_actions.last_error AS last_error,
			failed_actions.last_error_action AS last_error_action
		FROM aggregated_services
		LEFT JOIN desired_states
			ON desired_states.workload_key = aggregated_services.workload_key
			AND desired_states.cluster_id = aggregated_services.cluster_id
		LEFT JOIN active_actions
			ON active_actions.instance_id = aggregated_services.controller_instance_id
			AND active_actions.service_key = aggregated_services.workload_key
		LEFT JOIN failed_actions
			ON failed_actions.instance_id = aggregated_services.controller_instance_id
			AND failed_actions.service_key = aggregated_services.workload_key
		ORDER BY aggregated_services.last_seen DESC
		SETTINGS join_use_nulls = 1
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: ControllerService[];
	}>;
}

export async function getServiceById(
	serviceId: string,
	dbConfigId?: string
): Promise<{ err?: unknown; data?: ControllerService[] }> {
	const actionTbl = CONTROLLER_ACTIONS_TABLE;
	const desiredTbl = CONTROLLER_DESIRED_STATES_V2_TABLE;
	const query = `
		WITH service_row AS (
			SELECT *
			FROM ${CONTROLLER_SERVICES_TABLE}
			FINAL
			WHERE id = '${escapeClickHouse(serviceId)}'
			LIMIT 1
		),
		desired_state AS (
			SELECT
				workload_key,
				cluster_id,
				max(if(feature = 'instrumentation', desired_status, '')) AS desired_instrumentation_status,
				max(if(feature = 'agent', desired_status, '')) AS desired_agent_status
			FROM ${desiredTbl}
			FINAL
			GROUP BY workload_key, cluster_id
		),
		active_action AS (
			SELECT
				instance_id,
				service_key,
				CAST(argMax(action_type, updated_at), 'Nullable(String)') AS pending_action,
				CAST(argMax(status, updated_at), 'Nullable(String)') AS pending_action_status,
				max(updated_at) AS pending_action_updated_at
			FROM ${actionTbl}
			FINAL
			WHERE status IN ('pending', 'acknowledged')
			  AND updated_at >= now() - INTERVAL 15 SECOND
			GROUP BY instance_id, service_key
		),
		failed_action AS (
			SELECT
				instance_id,
				service_key,
				CAST(argMax(action_type, updated_at), 'Nullable(String)') AS last_error_action,
				CAST(argMax(result, updated_at), 'Nullable(String)') AS last_error,
				max(updated_at) AS failed_at
			FROM ${actionTbl}
			FINAL
			WHERE status = 'failed'
			  AND updated_at >= now() - INTERVAL 60 SECOND
			GROUP BY instance_id, service_key
		)
		SELECT
			service_row.id AS id,
			service_row.controller_instance_id AS controller_instance_id,
			service_row.service_name AS service_name,
			service_row.workload_key AS workload_key,
			service_row.namespace AS namespace,
			service_row.language_runtime AS language_runtime,
			service_row.llm_providers AS llm_providers,
			service_row.open_ports AS open_ports,
			service_row.deployment_name AS deployment_name,
			service_row.pid AS pid,
			service_row.exe_path AS exe_path,
			service_row.instrumentation_status AS instrumentation_status,
			service_row.resource_attributes AS resource_attributes,
			service_row.first_seen AS first_seen,
			service_row.last_seen AS last_seen,
			service_row.updated_at AS updated_at,
			service_row.cluster_id AS cluster_id,
			if(desired_state.desired_instrumentation_status = '' OR isNull(desired_state.desired_instrumentation_status), 'none', desired_state.desired_instrumentation_status) AS desired_instrumentation_status,
			if(desired_state.desired_agent_status = '' OR isNull(desired_state.desired_agent_status), 'none', desired_state.desired_agent_status) AS desired_agent_status,
			if(
				isNull(active_action.pending_action_updated_at) OR
					active_action.pending_action_updated_at < service_row.updated_at,
				CAST(NULL, 'Nullable(String)'),
				active_action.pending_action
			) AS pending_action,
			if(
				isNull(active_action.pending_action_updated_at) OR
					active_action.pending_action_updated_at < service_row.updated_at,
				CAST(NULL, 'Nullable(String)'),
				active_action.pending_action_status
			) AS pending_action_status,
			failed_action.last_error AS last_error,
			failed_action.last_error_action AS last_error_action
		FROM service_row
		LEFT JOIN desired_state
			ON desired_state.workload_key = service_row.workload_key
			AND desired_state.cluster_id = service_row.cluster_id
		LEFT JOIN active_action
			ON active_action.instance_id = service_row.controller_instance_id
			AND active_action.service_key = service_row.workload_key
		LEFT JOIN failed_action
			ON failed_action.instance_id = service_row.controller_instance_id
			AND failed_action.service_key = service_row.workload_key
		SETTINGS join_use_nulls = 1
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: ControllerService[];
	}>;
}

export async function getControllerIdsForWorkload(
	serviceName: string,
	namespace: string,
	clusterId: string = "default",
	dbConfigId?: string
): Promise<{ err?: unknown; data?: Array<{ controller_instance_id: string }> }> {
	const query = `
		SELECT DISTINCT controller_instance_id
		FROM ${CONTROLLER_SERVICES_TABLE}
		FINAL
		WHERE service_name = '${escapeClickHouse(serviceName)}'
		  AND namespace = '${escapeClickHouse(namespace)}'
		  AND cluster_id = '${escapeClickHouse(clusterId)}'
		  AND last_seen >= now() - INTERVAL 5 MINUTE
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: Array<{ controller_instance_id: string }>;
	}>;
}

export async function upsertServices(
	services: Partial<ControllerService>[],
	dbConfigId?: string
) {
	if (services.length === 0) return { data: "ok" };
	return dataCollector(
		{
			table: CONTROLLER_SERVICES_TABLE,
			values: services,
		},
		"insert",
		dbConfigId
	);
}

export async function getControllerConfig(
	instanceId: string,
	dbConfigId?: string
): Promise<{ err?: unknown; data?: Array<{ config: string }> }> {
	const query = `
		SELECT config
		FROM ${CONTROLLER_CONFIG_TABLE}
		FINAL
		WHERE instance_id = '${instanceId}'
		LIMIT 1
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: Array<{ config: string }>;
	}>;
}

export async function saveControllerConfig(
	instanceId: string,
	config: ControllerConfig,
	dbConfigId?: string
) {
	return dataCollector(
		{
			table: CONTROLLER_CONFIG_TABLE,
			values: [
				{
				instance_id: instanceId,
				config: JSON.stringify(config),
				updated_at: clickhouseNow(),
				},
			],
		},
		"insert",
		dbConfigId
	);
}

// --- Generic feature desired state functions (v2 table) ---

export async function getFeatureDesiredStates(
	workloadKeys: string[],
	clusterId: string,
	features?: string[],
	dbConfigId?: string
): Promise<{ err?: unknown; data?: FeatureDesiredState[] }> {
	if (workloadKeys.length === 0) return { data: [] };
	const escaped = workloadKeys
		.map((k) => `'${escapeClickHouse(k)}'`)
		.join(",");
	const featureFilter = features?.length
		? `AND feature IN (${features.map((f) => `'${escapeClickHouse(f)}'`).join(",")})`
		: "";
	const query = `
		SELECT
			workload_key,
			cluster_id,
			feature,
			desired_status,
			config,
			updated_at
		FROM ${CONTROLLER_DESIRED_STATES_V2_TABLE}
		FINAL
		WHERE cluster_id = '${escapeClickHouse(clusterId)}'
		  AND workload_key IN (${escaped})
		  ${featureFilter}
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: FeatureDesiredState[];
	}>;
}

export async function updateFeatureDesiredState(
	workloadKey: string,
	clusterId: string,
	feature: string,
	desiredStatus: string,
	config: string = "{}",
	dbConfigId?: string
) {
	return dataCollector(
		{
			table: CONTROLLER_DESIRED_STATES_V2_TABLE,
			values: [
				{
					workload_key: workloadKey,
					cluster_id: clusterId,
					feature,
					desired_status: desiredStatus,
					config,
					updated_at: clickhouseNow(),
				},
			],
		},
		"insert",
		dbConfigId
	);
}

/**
 * Backward-compatible wrapper. Reads from the v2 table and pivots
 * feature rows into the old column-based format callers expect.
 */
export async function getDesiredStatesForWorkloads(
	workloadKeys: string[],
	clusterId: string,
	dbConfigId?: string
): Promise<{
	err?: unknown;
	data?: Array<{
		workload_key: string;
		desired_instrumentation_status: string;
		desired_agent_status: string;
	}>;
}> {
	if (workloadKeys.length === 0) return { data: [] };
	const res = await getFeatureDesiredStates(
		workloadKeys,
		clusterId,
		["instrumentation", "agent"],
		dbConfigId
	);
	if (res.err) return { err: res.err };

	const map = new Map<
		string,
		{ desired_instrumentation_status: string; desired_agent_status: string }
	>();
	for (const row of res.data || []) {
		if (!map.has(row.workload_key)) {
			map.set(row.workload_key, {
				desired_instrumentation_status: "none",
				desired_agent_status: "none",
			});
		}
		const entry = map.get(row.workload_key)!;
		if (row.feature === "instrumentation") {
			entry.desired_instrumentation_status = row.desired_status;
		} else if (row.feature === "agent") {
			entry.desired_agent_status = row.desired_status;
		}
	}

	return {
		data: Array.from(map.entries()).map(([workload_key, vals]) => ({
			workload_key,
			...vals,
		})),
	};
}

/**
 * Backward-compatible wrapper. Writes to the v2 table, one row per feature.
 */
export async function updateDesiredStatus(
	workloadKey: string,
	clusterId: string,
	fields: {
		desired_instrumentation_status?: "none" | "instrumented";
		desired_agent_status?: "none" | "enabled";
	},
	dbConfigId?: string
) {
	if (
		fields.desired_instrumentation_status === undefined &&
		fields.desired_agent_status === undefined
	)
		return { data: "ok" };

	const writes: Promise<any>[] = [];
	if (fields.desired_instrumentation_status !== undefined) {
		writes.push(
			updateFeatureDesiredState(
				workloadKey,
				clusterId,
				"instrumentation",
				fields.desired_instrumentation_status,
				"{}",
				dbConfigId
			)
		);
	}
	if (fields.desired_agent_status !== undefined) {
		writes.push(
			updateFeatureDesiredState(
				workloadKey,
				clusterId,
				"agent",
				fields.desired_agent_status,
				"{}",
				dbConfigId
			)
		);
	}
	await Promise.all(writes);
	return { data: "ok" };
}

// --- Environment-level feature configs ---

export async function getEnvironmentFeatureConfigs(
	environment: string,
	clusterId: string,
	features?: string[],
	dbConfigId?: string
): Promise<{ err?: unknown; data?: EnvironmentFeatureConfig[] }> {
	const featureFilter = features?.length
		? `AND feature IN (${features.map((f) => `'${escapeClickHouse(f)}'`).join(",")})`
		: "";
	const query = `
		SELECT environment, cluster_id, feature, config, updated_at
		FROM ${CONTROLLER_ENV_CONFIGS_TABLE}
		FINAL
		WHERE environment = '${escapeClickHouse(environment)}'
		  AND cluster_id = '${escapeClickHouse(clusterId)}'
		  ${featureFilter}
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: EnvironmentFeatureConfig[];
	}>;
}

export async function saveEnvironmentFeatureConfig(
	environment: string,
	clusterId: string,
	feature: string,
	config: string,
	dbConfigId?: string
) {
	return dataCollector(
		{
			table: CONTROLLER_ENV_CONFIGS_TABLE,
			values: [
				{
					environment,
					cluster_id: clusterId,
					feature,
					config,
					updated_at: clickhouseNow(),
				},
			],
		},
		"insert",
		dbConfigId
	);
}

/**
 * @deprecated Use feature handler reconciliation via getAllFeatureHandlers() instead.
 * Kept for backward compatibility with existing tests.
 */
export async function getServicesToReconcile(
	controllerInstanceId: string,
	reportedServices: Array<{
		workload_key: string;
		instrumentation_status: string;
		resource_attributes?: Record<string, string>;
	}>,
	clusterId: string,
	dbConfigId?: string
): Promise<{
	instrumentKeys: string[];
	uninstrumentKeys: string[];
	enableAgentKeys: string[];
	disableAgentKeys: string[];
}> {
	const result = {
		instrumentKeys: [] as string[],
		uninstrumentKeys: [] as string[],
		enableAgentKeys: [] as string[],
		disableAgentKeys: [] as string[],
	};

	const workloadKeys = reportedServices
		.map((s) => s.workload_key)
		.filter(Boolean);
	if (workloadKeys.length === 0) return result;

	const desiredRes = await getDesiredStatesForWorkloads(
		workloadKeys,
		clusterId,
		dbConfigId
	);
	if (desiredRes.err || !desiredRes.data) return result;

	const desiredMap = new Map(
		desiredRes.data.map((d) => [d.workload_key, d])
	);

	for (const svc of reportedServices) {
		const desired = desiredMap.get(svc.workload_key);
		if (!desired) continue;

		const agentStatus =
			(svc as any).agent_observability_status ||
			svc.resource_attributes?.["openlit.agent_observability.status"] ||
			"disabled";

		if (
			desired.desired_instrumentation_status === "instrumented" &&
			svc.instrumentation_status !== "instrumented"
		) {
			result.instrumentKeys.push(svc.workload_key);
		}
		if (
			desired.desired_instrumentation_status === "none" &&
			svc.instrumentation_status === "instrumented"
		) {
			result.uninstrumentKeys.push(svc.workload_key);
		}
		if (
			desired.desired_agent_status === "enabled" &&
			agentStatus !== "enabled"
		) {
			result.enableAgentKeys.push(svc.workload_key);
		}
		if (
			desired.desired_agent_status === "none" &&
			agentStatus === "enabled"
		) {
			result.disableAgentKeys.push(svc.workload_key);
		}
	}

	return result;
}

// --- Action queue (pull-based: UI queues actions, controller polls for them) ---

export async function queueAction(
	instanceId: string,
	actionType: ActionType,
	serviceKey: string,
	payload: string = "{}",
	dbConfigId?: string
) {
	const existingAction = (await dataCollector(
		{
			query: `
				SELECT id, action_type, status
				FROM ${CONTROLLER_ACTIONS_TABLE}
				FINAL
				WHERE instance_id = '${instanceId}'
				  AND service_key = '${serviceKey}'
				  AND action_type = '${actionType}'
				  AND status IN ('pending', 'acknowledged')
				ORDER BY updated_at DESC
				LIMIT 1
			`,
		},
		"query",
		dbConfigId
	)) as {
		err?: unknown;
		data?: Array<{
			id: string;
			action_type: ActionType;
			status: ActionStatus;
		}>;
	};

	if (existingAction.data && existingAction.data.length > 0) {
		return { data: existingAction.data[0] };
	}

	return dataCollector(
		{
			table: CONTROLLER_ACTIONS_TABLE,
			values: [
				{
					instance_id: instanceId,
					action_type: actionType,
					service_key: serviceKey,
					payload,
				status: "pending",
				created_at: clickhouseNow(),
				updated_at: clickhouseNow(),
				},
			],
		},
		"insert",
		dbConfigId
	);
}

export async function getPendingActions(
	instanceId: string,
	dbConfigId?: string
): Promise<{ err?: unknown; data?: PendingAction[] }> {
	const query = `
		SELECT *
		FROM ${CONTROLLER_ACTIONS_TABLE}
		FINAL
		WHERE instance_id = '${instanceId}'
		  AND status = 'pending'
		ORDER BY created_at ASC
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: PendingAction[];
	}>;
}

export async function markActionsAcknowledged(
	actions: PendingAction[],
	instanceId: string,
	dbConfigId?: string
) {
	if (actions.length === 0) return { data: "ok" };
	const rows = actions.map((a) => ({
		id: a.id,
		instance_id: instanceId,
		action_type: a.action_type,
		service_key: a.service_key,
		payload: a.payload,
		status: "acknowledged" as const,
		updated_at: clickhouseNow(),
	}));
	return dataCollector(
		{ table: CONTROLLER_ACTIONS_TABLE, values: rows },
		"insert",
		dbConfigId
	);
}

export async function completeAction(
	actionId: string,
	instanceId: string,
	status: "completed" | "failed",
	result: string = "",
	dbConfigId?: string
) {
	const existingAction = (await dataCollector(
		{
			query: `
				SELECT id, instance_id, action_type, service_key, payload, created_at
				FROM ${CONTROLLER_ACTIONS_TABLE}
				FINAL
				WHERE id = '${actionId}'
				  AND instance_id = '${instanceId}'
				LIMIT 1
			`,
		},
		"query",
		dbConfigId
	)) as {
		err?: unknown;
		data?: Array<{
			id: string;
			instance_id: string;
			action_type: ActionType;
			service_key: string;
			payload: string;
			created_at: string;
		}>;
	};

	if (existingAction.err) {
		return existingAction;
	}

	if (!existingAction.data || existingAction.data.length === 0) {
		return { err: `Action ${actionId} not found` };
	}

	const action = existingAction.data[0];
	return dataCollector(
		{
			table: CONTROLLER_ACTIONS_TABLE,
			values: [
				{
					id: action.id,
					instance_id: action.instance_id,
					action_type: action.action_type,
					service_key: action.service_key,
					payload: action.payload,
					status,
					result,
					created_at: action.created_at,
					updated_at: clickhouseNow(),
				},
			],
		},
		"insert",
		dbConfigId
	);
}

export function getConfigHash(config: ControllerConfig): string {
	const data = JSON.stringify(config);
	return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}
