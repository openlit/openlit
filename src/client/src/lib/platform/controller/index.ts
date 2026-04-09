import { dataCollector } from "@/lib/platform/common";
import {
	CONTROLLER_SERVICES_TABLE,
	CONTROLLER_INSTANCES_TABLE,
	CONTROLLER_CONFIG_TABLE,
	CONTROLLER_ACTIONS_TABLE,
} from "./table-details";
import type {
	ControllerConfig,
	ControllerInstance,
	ControllerService,
	ActionType,
	ActionStatus,
	PendingAction,
} from "@/types/controller";
import crypto from "crypto";

function clickhouseNow(): string {
	return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
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
	const query = `
		WITH aggregated_services AS (
			SELECT
				argMax(id, ${tbl}.last_seen) AS id,
				controller_instance_id,
				argMax(service_name, ${tbl}.last_seen) AS service_name,
				workload_key,
				argMax(namespace, ${tbl}.last_seen) AS namespace,
				argMax(language_runtime, ${tbl}.last_seen) AS language_runtime,
				arrayDistinct(arrayFlatten(groupArray(llm_providers))) AS llm_providers,
				argMax(open_ports, ${tbl}.last_seen) AS open_ports,
				argMax(deployment_name, ${tbl}.last_seen) AS deployment_name,
				argMax(pid, ${tbl}.last_seen) AS pid,
				argMax(exe_path, ${tbl}.last_seen) AS exe_path,
				argMax(instrumentation_status, ${tbl}.last_seen) AS instrumentation_status,
				argMax(resource_attributes, ${tbl}.last_seen) AS resource_attributes,
				min(${tbl}.first_seen) AS first_seen,
				max(${tbl}.last_seen) AS last_seen,
				max(${tbl}.updated_at) AS updated_at
			FROM ${tbl}
			FINAL
			${timeFilter}
			GROUP BY controller_instance_id, workload_key
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
		)
		SELECT
			aggregated_services.*,
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
			) AS pending_action_status
		FROM aggregated_services
		LEFT JOIN active_actions
			ON active_actions.instance_id = aggregated_services.controller_instance_id
			AND active_actions.service_key = aggregated_services.workload_key
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
	const query = `
		WITH service_row AS (
			SELECT *
			FROM ${CONTROLLER_SERVICES_TABLE}
			FINAL
			WHERE id = '${serviceId}'
			LIMIT 1
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
		)
		SELECT
			service_row.*,
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
			) AS pending_action_status
		FROM service_row
		LEFT JOIN active_action
			ON active_action.instance_id = service_row.controller_instance_id
			AND active_action.service_key = service_row.workload_key
		SETTINGS join_use_nulls = 1
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: ControllerService[];
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
