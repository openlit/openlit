import { dataCollector } from "@/lib/platform/common";
import {
	COLLECTOR_SERVICES_TABLE,
	COLLECTOR_INSTANCES_TABLE,
	COLLECTOR_CONFIG_TABLE,
	COLLECTOR_ACTIONS_TABLE,
} from "./table-details";
import type {
	CollectorConfig,
	CollectorInstance,
	CollectorService,
	ActionType,
	ActionStatus,
	PendingAction,
} from "@/types/collector";
import crypto from "crypto";

function clickhouseNow(): string {
	return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

// --- ClickHouse queries (OpenLIT dashboard reads/writes) ---

export async function getCollectorInstances(
	dbConfigId?: string
): Promise<{ err?: unknown; data?: CollectorInstance[] }> {
	const query = `
		SELECT *
		FROM ${COLLECTOR_INSTANCES_TABLE}
		FINAL
		ORDER BY last_heartbeat DESC
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: CollectorInstance[];
	}>;
}

export async function getCollectorInstanceById(
	instanceId: string,
	dbConfigId?: string
): Promise<{ err?: unknown; data?: CollectorInstance[] }> {
	const query = `
		SELECT *
		FROM ${COLLECTOR_INSTANCES_TABLE}
		FINAL
		WHERE instance_id = '${instanceId}'
		LIMIT 1
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: CollectorInstance[];
	}>;
}

export async function upsertCollectorInstance(
	instance: Partial<CollectorInstance>,
	dbConfigId?: string
) {
	return dataCollector(
		{
			table: COLLECTOR_INSTANCES_TABLE,
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
): Promise<{ err?: unknown; data?: CollectorService[] }> {
	const tbl = COLLECTOR_SERVICES_TABLE;
	let timeFilter = "";
	if (timeStart && timeEnd) {
		timeFilter = `WHERE ${tbl}.last_seen >= '${timeStart}' AND ${tbl}.last_seen <= '${timeEnd}'`;
	}
	const query = `
		SELECT
			argMax(id, ${tbl}.last_seen) AS id,
			argMax(collector_instance_id, ${tbl}.last_seen) AS collector_instance_id,
			service_name,
			namespace,
			argMax(language_runtime, ${tbl}.last_seen) AS language_runtime,
			arrayDistinct(arrayFlatten(groupArray(llm_providers))) AS llm_providers,
			argMax(open_ports, ${tbl}.last_seen) AS open_ports,
			argMax(deployment_name, ${tbl}.last_seen) AS deployment_name,
			argMax(pid, ${tbl}.last_seen) AS pid,
			argMax(exe_path, ${tbl}.last_seen) AS exe_path,
			argMax(instrumentation_status, ${tbl}.last_seen) AS instrumentation_status,
			min(${tbl}.first_seen) AS first_seen,
			max(${tbl}.last_seen) AS last_seen,
			max(${tbl}.updated_at) AS updated_at
		FROM ${tbl}
		FINAL
		${timeFilter}
		GROUP BY namespace, service_name
		ORDER BY last_seen DESC
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: CollectorService[];
	}>;
}

export async function getServiceById(
	serviceId: string,
	dbConfigId?: string
): Promise<{ err?: unknown; data?: CollectorService[] }> {
	const query = `
		SELECT *
		FROM ${COLLECTOR_SERVICES_TABLE}
		FINAL
		WHERE id = '${serviceId}'
		LIMIT 1
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: CollectorService[];
	}>;
}

export async function upsertServices(
	services: Partial<CollectorService>[],
	dbConfigId?: string
) {
	if (services.length === 0) return { data: "ok" };
	return dataCollector(
		{
			table: COLLECTOR_SERVICES_TABLE,
			values: services,
		},
		"insert",
		dbConfigId
	);
}

export async function updateServiceStatus(
	collectorInstanceId: string,
	namespace: string,
	serviceName: string,
	status: "discovered" | "instrumented",
	dbConfigId?: string
) {
	const query = `
		ALTER TABLE ${COLLECTOR_SERVICES_TABLE}
		UPDATE instrumentation_status = '${status}', updated_at = now()
		WHERE collector_instance_id = '${collectorInstanceId}'
		  AND namespace = '${namespace}'
		  AND service_name = '${serviceName}'
	`;
	return dataCollector({ query }, "exec", dbConfigId);
}

export async function getCollectorConfig(
	instanceId: string,
	dbConfigId?: string
): Promise<{ err?: unknown; data?: Array<{ config: string }> }> {
	const query = `
		SELECT config
		FROM ${COLLECTOR_CONFIG_TABLE}
		FINAL
		WHERE instance_id = '${instanceId}'
		LIMIT 1
	`;
	return dataCollector({ query }, "query", dbConfigId) as Promise<{
		err?: unknown;
		data?: Array<{ config: string }>;
	}>;
}

export async function saveCollectorConfig(
	instanceId: string,
	config: CollectorConfig,
	dbConfigId?: string
) {
	return dataCollector(
		{
			table: COLLECTOR_CONFIG_TABLE,
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

// --- Action queue (pull-based: UI queues actions, collector polls for them) ---

export async function queueAction(
	instanceId: string,
	actionType: ActionType,
	serviceKey: string,
	payload: string = "{}",
	dbConfigId?: string
) {
	return dataCollector(
		{
			table: COLLECTOR_ACTIONS_TABLE,
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
		FROM ${COLLECTOR_ACTIONS_TABLE}
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
		{ table: COLLECTOR_ACTIONS_TABLE, values: rows },
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
	return dataCollector(
		{
			table: COLLECTOR_ACTIONS_TABLE,
			values: [
				{
					id: actionId,
					instance_id: instanceId,
					status,
				result,
				updated_at: clickhouseNow(),
				},
			],
		},
		"insert",
		dbConfigId
	);
}

export function getConfigHash(config: CollectorConfig): string {
	const data = JSON.stringify(config);
	return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}
