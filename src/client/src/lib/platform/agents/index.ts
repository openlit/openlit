/**
 * Listing + detail lookups for the unified agents page.
 *
 * Reads target `openlit_agents_summary` (the materializer is the sole consumer
 * of raw otel_traces for agents data) and overlay a read-time rollup of the
 * controller's desired-state and per-pod action queue. The rollup lives in
 * the read path, not the materializer, so the desired/pending state stays
 * current within seconds of a click without racing the materializer's tick.
 */

import { createHash } from "crypto";
import { dataCollector } from "@/lib/platform/common";
import {
	CONTROLLER_ACTIONS_TABLE,
	CONTROLLER_DESIRED_STATES_V2_TABLE,
	CONTROLLER_SERVICES_TABLE,
} from "@/lib/platform/controller/table-details";
import type {
	AgentListCursor,
	AgentListFilters,
	AgentSource,
	UnifiedAgent,
} from "@/types/agents";
import { invalidate, POLICY_DETAIL, POLICY_LIST, swr } from "./cache";
import { agentsLogger } from "./logger";
import { AGENTS_SUMMARY_TABLE } from "./table-details";
import { escapeClickHouseString } from "@/lib/clickhouse-escape";
import { recomputeCodingAgentsForWindow } from "./materialize";

const escape = escapeClickHouseString;

function escapeList(values: string[]): string {
	return values.map((v) => `'${escape(v)}'`).join(", ");
}

function rowToAgent(row: Record<string, unknown>): UnifiedAgent {
	const controllerServiceId = String(row.controller_service_id || "");
	const controllerInstanceId = String(row.controller_instance_id || "");
	const pendingAction = String(row.pending_action || "");
	const pendingActionStatus = String(row.pending_action_status || "");
	const agentObsStatus = String(row.agent_observability_status || "") as UnifiedAgent["agent_observability_status"];
	return {
		agent_key: String(row.agent_key),
		service_name: String(row.service_name),
		environment: String(row.environment || "default"),
		cluster_id: String(row.cluster_id || "default"),
		workload_key: String(row.workload_key || ""),
		source: String(row.source || "sdk") as AgentSource,
		controller_service_id: controllerServiceId ? controllerServiceId : null,
		controller_instance_id: controllerInstanceId ? controllerInstanceId : null,
		primary_model: String(row.primary_model || ""),
		models: Array.isArray(row.models) ? (row.models as string[]) : [],
		providers: Array.isArray(row.providers) ? (row.providers as string[]) : [],
		tool_names: Array.isArray(row.tool_names) ? (row.tool_names as string[]) : [],
		tool_count: Number(row.tool_count || 0),
		request_count_24h: Number(row.request_count_24h || 0),
		current_version_hash: String(row.current_version_hash || ""),
		current_version_number: Number(row.current_version_number || 0),
		sdk_version: String(row.sdk_version || ""),
		sdk_language: String(row.sdk_language || ""),
		instrumentation_status: (String(row.instrumentation_status || "discovered") as UnifiedAgent["instrumentation_status"]),
		desired_instrumentation_status: (String(row.desired_instrumentation_status || "none") as UnifiedAgent["desired_instrumentation_status"]),
		agent_observability_status: agentObsStatus,
		desired_agent_status: (String(row.desired_agent_status || "none") as UnifiedAgent["desired_agent_status"]),
		lifecycle_status: (String(row.lifecycle_status || "unknown") as UnifiedAgent["lifecycle_status"]),
		desired_lifecycle_status: (String(row.desired_lifecycle_status || "unknown") as UnifiedAgent["desired_lifecycle_status"]),
		pending_action: pendingAction ? pendingAction : null,
		pending_action_status: pendingActionStatus
			? (pendingActionStatus as UnifiedAgent["pending_action_status"])
			: null,
		first_seen: String(row.first_seen),
		last_seen: String(row.last_seen),
		updated_at: String(row.updated_at),
		last_materialized_at: String(row.last_materialized_at || row.updated_at),
		pods_total: Number(row.pods_total || 0),
		pods_pending: Number(row.pods_pending || 0),
		pods_acknowledged: Number(row.pods_acknowledged || 0),
		coding_agent_vendor:
			(String(row.coding_agent_vendor || "") || undefined) as UnifiedAgent["coding_agent_vendor"],
		coding_session_count_24h: Number(row.coding_session_count_24h || 0),
		coding_cost_usd_24h: Number(row.coding_cost_usd_24h || 0),
		coding_active_users_24h: Number(row.coding_active_users_24h || 0),
		coding_lines_added_24h: Number(row.coding_lines_added_24h || 0),
		coding_lines_removed_24h: Number(row.coding_lines_removed_24h || 0),
		coding_lines_accepted_24h: Number(row.coding_lines_accepted_24h || 0),
		coding_lines_rejected_24h: Number(row.coding_lines_rejected_24h || 0),
		coding_edit_accept_24h: Number(row.coding_edit_accept_24h || 0),
		coding_edit_reject_24h: Number(row.coding_edit_reject_24h || 0),
		coding_commit_count_24h: Number(row.coding_commit_count_24h || 0),
		coding_pr_count_24h: Number(row.coding_pr_count_24h || 0),
	};
}

/**
 * Read-time rollup CTEs. We fold the controller's truth (desired state +
 * per-pod action queue) into the per-(service_name, cluster_id) rows here
 * rather than in the materializer. Two upsides:
 *   - No race between materializer ticks and controller writes — a click is
 *     visible on the next read, not 60s later when the materializer runs.
 *   - Multi-pod fan-out becomes an honest rollup: we count pods in each
 *     status instead of picking one pod's action_type as the "truth".
 */
const ROLLUP_CTES = `
WITH pod_set AS (
	SELECT
		workload_key,
		cluster_id,
		argMax(service_name, last_seen) AS service_name,
		uniqExact(controller_instance_id) AS pods_total,
		groupArrayDistinct(controller_instance_id) AS instance_ids,
		argMax(resource_attributes['openlit.agent_observability.status'], last_seen) AS agent_observability_status,
		-- Mirrors the agent_observability rollup. The controller stamps
		-- resource_attributes['openlit.lifecycle.status'] on every
		-- heartbeat after a Play / Stop / Restart so the UI sees the
		-- actual state of the workload, not just the desired state.
		argMax(resource_attributes['openlit.lifecycle.status'], last_seen) AS lifecycle_status
	FROM ${CONTROLLER_SERVICES_TABLE}
	FINAL
	WHERE last_seen >= now() - INTERVAL 5 MINUTE
		AND workload_key != ''
	GROUP BY workload_key, cluster_id
),
desired_llm AS (
	SELECT
		workload_key,
		cluster_id,
		argMax(desired_status, updated_at) AS desired_status
	FROM ${CONTROLLER_DESIRED_STATES_V2_TABLE}
	FINAL
	WHERE feature = 'instrumentation'
	GROUP BY workload_key, cluster_id
),
desired_agent AS (
	SELECT
		workload_key,
		cluster_id,
		argMax(desired_status, updated_at) AS desired_status
	FROM ${CONTROLLER_DESIRED_STATES_V2_TABLE}
	FINAL
	WHERE feature = 'agent'
	GROUP BY workload_key, cluster_id
),
desired_lifecycle AS (
	-- A row here means the user has explicitly Played or Stopped the
	-- workload. It is also the source of truth for the snapshot blob
	-- (config column) used to bring K8s naked pods and Linux bare
	-- processes back up after Stop.
	SELECT
		workload_key,
		cluster_id,
		argMax(desired_status, updated_at) AS desired_status,
		argMax(config, updated_at) AS config
	FROM ${CONTROLLER_DESIRED_STATES_V2_TABLE}
	FINAL
	WHERE feature = 'lifecycle'
	GROUP BY workload_key, cluster_id
),
pod_action_latest AS (
	-- Per (instance_id, service_key), keep the most recent action row.
	-- We rename the max(updated_at) projection to last_updated_at so the
	-- argMax(..., updated_at) calls keep referring to the *column*
	-- updated_at rather than colliding with the alias (ClickHouse errors
	-- with "aggregate inside another aggregate" if we use the same name).
	SELECT
		instance_id,
		service_key,
		argMax(action_type, updated_at) AS action_type,
		argMax(status, updated_at) AS status,
		max(updated_at) AS last_updated_at
	FROM ${CONTROLLER_ACTIONS_TABLE} FINAL
	GROUP BY instance_id, service_key
	HAVING status IN ('pending', 'acknowledged')
		AND last_updated_at >= now() - INTERVAL 5 MINUTE
),
pod_actions AS (
	SELECT
		service_key,
		argMax(action_type, last_updated_at) AS pending_action,
		if(countIf(status = 'pending') > 0, 'pending', 'acknowledged') AS pending_action_status,
		countIf(status = 'pending') AS pods_pending,
		countIf(status = 'acknowledged') AS pods_acknowledged
	FROM pod_action_latest
	GROUP BY service_key
)
`;

/**
 * Columns selected from the summary table joined against the rollup CTEs.
 * Every controller-truth column (`desired_*`, `pending_*`, `agent_observability_status`,
 * `pods_*`) is sourced from the rollup CTEs. The summary table only owns the
 * SDK-discovered identity + telemetry-derived facts (models, providers, tools,
 * counts, version pointer).
 */
const SELECT_COLUMNS = `
	s.agent_key AS agent_key,
	s.service_name AS service_name,
	s.environment AS environment,
	s.cluster_id AS cluster_id,
	s.workload_key AS workload_key,
	s.source AS source,
	s.controller_service_id AS controller_service_id,
	s.controller_instance_id AS controller_instance_id,
	s.primary_model AS primary_model,
	s.models AS models,
	s.providers AS providers,
	s.tool_names AS tool_names,
	s.tool_count AS tool_count,
	s.request_count_24h AS request_count_24h,
	s.current_version_hash AS current_version_hash,
	s.current_version_number AS current_version_number,
	s.sdk_version AS sdk_version,
	s.sdk_language AS sdk_language,
	s.instrumentation_status AS instrumentation_status,
	if(desired_llm.desired_status != '', desired_llm.desired_status, 'none') AS desired_instrumentation_status,
	-- "Actual" observability comes from the controller's most recent heartbeat
	-- (resource_attributes['openlit.agent_observability.status']). For pure
	-- SDK rows there is no matching pod_set row, so we synthesise an
	-- 'enabled' value -- the SDK is the thing emitting traces and the user
	-- cannot disable it from this UI anyway. For source='both' the
	-- controller IS managing the workload and we want its reported state to
	-- win even right after a successful disable (when the openlit SDK has
	-- not yet aged out of the materializer's 30-min lookback window).
	coalesce(pod_set.agent_observability_status, if(s.source = 'sdk', 'enabled', '')) AS agent_observability_status,
	if(desired_agent.desired_status != '', desired_agent.desired_status, 'none') AS desired_agent_status,
	-- Lifecycle:
	--   - For SDK-only rows there is nothing to lifecycle-manage; render
	--     'unknown' so the UI hides the buttons (the LifecycleCell also
	--     guards on source != 'sdk').
	--   - When pod_set has a value, that is the most authoritative
	--     reading (it came from the latest heartbeat).
	--   - When pod_set is empty AND the user has stopped the workload,
	--     trust the desired_status='stopped' as the actual state -- the
	--     heartbeat went silent because the workload is down. This is
	--     what keeps the row visible as "Stopped" in the UI.
	if(s.source = 'sdk' AND pod_set.lifecycle_status = '',
		'unknown',
		if(pod_set.lifecycle_status != '',
			pod_set.lifecycle_status,
			if(desired_lifecycle.desired_status = 'stopped', 'stopped', 'running')
		)
	) AS lifecycle_status,
	if(desired_lifecycle.desired_status != '', desired_lifecycle.desired_status, 'unknown') AS desired_lifecycle_status,
	if(pod_actions.pending_action != '', pod_actions.pending_action, '') AS pending_action,
	if(pod_actions.pending_action_status != '', pod_actions.pending_action_status, '') AS pending_action_status,
	s.first_seen AS first_seen,
	s.last_seen AS last_seen,
	s.updated_at AS updated_at,
	s.last_materialized_at AS last_materialized_at,
	coalesce(pod_set.pods_total, 0) AS pods_total,
	coalesce(pod_actions.pods_pending, 0) AS pods_pending,
	coalesce(pod_actions.pods_acknowledged, 0) AS pods_acknowledged,
	-- Coding-agent rollups. Only populated when source = 'coding'; always
	-- 0/empty for other rows. Returned unconditionally so the front-end
	-- can render uniformly without an if-coding branch on every cell.
	s.coding_agent_vendor AS coding_agent_vendor,
	s.coding_session_count_24h AS coding_session_count_24h,
	s.coding_cost_usd_24h AS coding_cost_usd_24h,
	s.coding_active_users_24h AS coding_active_users_24h,
	s.coding_lines_added_24h AS coding_lines_added_24h,
	s.coding_lines_removed_24h AS coding_lines_removed_24h,
	s.coding_lines_accepted_24h AS coding_lines_accepted_24h,
	s.coding_lines_rejected_24h AS coding_lines_rejected_24h,
	s.coding_edit_accept_24h AS coding_edit_accept_24h,
	s.coding_edit_reject_24h AS coding_edit_reject_24h,
	s.coding_commit_count_24h AS coding_commit_count_24h,
	s.coding_pr_count_24h AS coding_pr_count_24h
`;

/**
 * LEFT JOINs from the summary table into the rollup CTEs.
 *
 * Everything keys off `s.workload_key` rather than going through pod_set.
 * That matters because pod_set filters `last_seen >= now() - 5 MINUTE` —
 * if the controller misses a heartbeat (default poll is 60s, K8s rolling
 * updates can stall for minutes), routing the desired-state join through
 * pod_set would silently drop the join and the UI would see
 * desired_status='none' even when openlit_controller_desired_states_v2
 * still has 'enabled'. Keying off the materialized s.workload_key keeps
 * desired state visible across heartbeat windows.
 */
const ROLLUP_JOINS = `
	LEFT JOIN pod_set
		ON pod_set.workload_key = s.workload_key
		AND pod_set.cluster_id = s.cluster_id
	LEFT JOIN desired_llm
		ON desired_llm.workload_key = s.workload_key
		AND desired_llm.cluster_id = s.cluster_id
	LEFT JOIN desired_agent
		ON desired_agent.workload_key = s.workload_key
		AND desired_agent.cluster_id = s.cluster_id
	LEFT JOIN desired_lifecycle
		ON desired_lifecycle.workload_key = s.workload_key
		AND desired_lifecycle.cluster_id = s.cluster_id
	LEFT JOIN pod_actions
		ON pod_actions.service_key = s.workload_key
`;

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export interface ListAgentsParams {
	timeStart?: string;
	timeEnd?: string;
	cursor?: AgentListCursor | null;
	limit?: number;
	filters?: AgentListFilters;
	dbConfigId?: string;
}

export interface ListAgentsResult {
	data: UnifiedAgent[];
	nextCursor: AgentListCursor | null;
}

function filtersHash(p: ListAgentsParams): string {
	return JSON.stringify({
		s: p.timeStart || "",
		e: p.timeEnd || "",
		f: p.filters || {},
		l: p.limit || DEFAULT_LIMIT,
		c: p.cursor || null,
	});
}

export async function listAgents(
	params: ListAgentsParams = {}
): Promise<ListAgentsResult> {
	const cacheKey = `agents:list:${params.dbConfigId || "default"}:${filtersHash(params)}`;
	return swr(cacheKey, POLICY_LIST, () => loadAgents(params));
}

async function loadAgents(params: ListAgentsParams): Promise<ListAgentsResult> {
	const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
	const filters = params.filters || {};

	const where: string[] = [];

	// `start` is a hard lower bound (`agents seen since X`). `end` is treated as
	// an *optional* upper bound: relative time ranges (24H/7D/1M/3M) leave it
	// off so we always include the most recent materialized rows, even if the
	// browser captured `end` slightly before the materializer wrote the row.
	// Custom ranges still send both bounds.
	//
	// Stopped-workload exception: a workload the user has Stopped no longer
	// emits heartbeats, so `s.last_seen` ages out fast. We special-case it
	// by OR-ing in any row whose lifecycle desired-state is 'stopped' --
	// those stay visible until the 90-day desired-states TTL collapses the
	// row organically. Without this OR, clicking Stop would feel like the
	// workload disappeared from the dashboard, which is exactly the bug
	// the lifecycle UNION in the materializer is meant to prevent.
	const stoppedRowClause = `desired_lifecycle.desired_status = 'stopped'`;
	if (params.timeStart) {
		where.push(
			`(s.last_seen >= parseDateTimeBestEffort('${escape(params.timeStart)}') OR ${stoppedRowClause})`
		);
	} else {
		where.push(`(s.last_seen >= now() - INTERVAL 30 DAY OR ${stoppedRowClause})`);
	}
	if (params.timeEnd) {
		where.push(
			`s.last_seen <= parseDateTimeBestEffort('${escape(params.timeEnd)}')`
		);
	}

	// Hide stale SDK-only rows. When a controller-managed container is recreated
	// for SDK-injection, the original `service.name` (from compose service or
	// container hostname) stops emitting and any phantom row materialized from
	// pre-recreate traces lingers in `openlit_agents_summary` until TTL (90d).
	// Filtering by `last_seen >= now() - 10 MINUTE` for source='sdk' rows lets
	// such phantoms drop out of the UI within a few minutes without waiting for
	// TTL. Controller-source rows are left untouched because they get refreshed
	// every controller heartbeat (~10s).
	where.push(
		`(s.source != 'sdk' OR s.last_seen >= now() - INTERVAL 10 MINUTE)`
	);

	// Same problem, different source: when a coding-agent vendor stops
	// emitting (e.g. the user disables their Claude Code plugin), the
	// materializer doesn't tombstone the row because
	// `discoverCodingAgents` only returns vendors with current data —
	// no INSERT means no new `last_materialized_at`, so the previous
	// row (with its non-zero `coding_session_count_24h` /
	// `coding_cost_usd_24h`) lingers until the 90d TTL. The hub then
	// shows e.g. "Claude Code · 6 sessions · 1 user" with clickthrough
	// landing on an empty detail page because otel_traces has no
	// matching spans. Gating on `last_materialized_at` (not
	// `last_seen` — last_seen is the timestamp of the last hosted span
	// at the time of materialization, NOT when we last refreshed)
	// hides coding rows whose materializer skipped them this round.
	// 10 minutes matches the SDK guard and gives the cron-driven
	// materializer plenty of headroom.
	where.push(
		`(s.source != 'coding' OR s.last_materialized_at >= now() - INTERVAL 10 MINUTE)`
	);

	if (filters.source?.length) {
		where.push(`s.source IN (${escapeList(filters.source)})`);
	}
	if (filters.environments?.length) {
		where.push(`s.environment IN (${escapeList(filters.environments)})`);
	}
	if (filters.providers?.length) {
		where.push(`arrayExists(p -> p IN (${escapeList(filters.providers)}), s.providers)`);
	}
	if (filters.statuses?.length) {
		const clauses: string[] = [];
		if (filters.statuses.includes("instrumented")) {
			clauses.push(`s.instrumentation_status = 'instrumented'`);
		}
		if (filters.statuses.includes("discovered")) {
			clauses.push(`s.instrumentation_status = 'discovered'`);
		}
		if (filters.statuses.includes("sdk")) {
			clauses.push(`s.source IN ('sdk', 'both')`);
		}
		if (clauses.length) {
			where.push(`(${clauses.join(" OR ")})`);
		}
	}

	if (params.cursor) {
		// Tuple comparison: rows strictly past (last_seen, agent_key) cursor.
		where.push(
			`(s.last_seen, s.agent_key) < (parseDateTimeBestEffort('${escape(params.cursor.last_seen)}'), '${escape(params.cursor.agent_key)}')`
		);
	}

	const query = `
		${ROLLUP_CTES}
		SELECT ${SELECT_COLUMNS}
		FROM ${AGENTS_SUMMARY_TABLE} AS s FINAL
		${ROLLUP_JOINS}
		WHERE ${where.join(" AND ")}
		ORDER BY s.last_seen DESC, s.agent_key DESC
		LIMIT ${limit + 1}
		SETTINGS join_use_nulls = 1
	`;

	const res = await dataCollector({ query }, "query", params.dbConfigId);
	if (res.err) {
		agentsLogger.error("list_agents_failed", {
			err: res.err,
			filters,
			limit,
		});
		return { data: [], nextCursor: null };
	}

	const rows = ((res.data as Record<string, unknown>[]) || []).map(rowToAgent);
	let nextCursor: AgentListCursor | null = null;
	if (rows.length > limit) {
		const last = rows[limit - 1];
		nextCursor = { last_seen: last.last_seen, agent_key: last.agent_key };
		rows.length = limit;
	}

	// Live overlay for the Coding Agents hub card. The summary table
	// stores `coding_session_count_24h` / `_active_users_24h` /
	// `_cost_usd_24h` — values the materializer bakes in once a tick
	// for the trailing 24h. That doesn't agree with what the per-tab
	// (Sessions / Users / Dashboard) views show when the user picks a
	// different range in the top-right time filter.
	//
	// To keep all four views answering the same question for the same
	// window, we recompute coding rows live whenever this list is
	// scoped to coding sources AND the caller passed a non-default
	// time window. We only do this when the caller is *exclusively*
	// asking for coding (the Coding Agents tab passes
	// `?source=coding`), so the Apps / Controllers paths skip the
	// extra round-trip.
	if (
		filters.source &&
		filters.source.length > 0 &&
		filters.source.every((s) => s === "coding") &&
		(params.timeStart || params.timeEnd)
	) {
		try {
			const liveRows = await recomputeCodingAgentsForWindow(
				{
					timeStart: params.timeStart,
					timeEnd: params.timeEnd,
				},
				params.dbConfigId
			);
			const overlay = new Map<string, (typeof liveRows)[number]>();
			for (const r of liveRows) overlay.set(r.agent_key, r);
			for (let i = 0; i < rows.length; i++) {
				const liveRow = overlay.get(rows[i].agent_key);
				if (!liveRow) continue;
				rows[i] = {
					...rows[i],
					coding_session_count_24h: liveRow.coding_session_count_24h,
					coding_active_users_24h: liveRow.coding_active_users_24h,
					coding_cost_usd_24h: liveRow.coding_cost_usd_24h,
					coding_lines_added_24h: liveRow.coding_lines_added_24h,
					coding_lines_removed_24h: liveRow.coding_lines_removed_24h,
					coding_lines_accepted_24h: liveRow.coding_lines_accepted_24h,
					coding_lines_rejected_24h: liveRow.coding_lines_rejected_24h,
					coding_edit_accept_24h: liveRow.coding_edit_accept_24h,
					coding_edit_reject_24h: liveRow.coding_edit_reject_24h,
					coding_commit_count_24h: liveRow.coding_commit_count_24h,
					coding_pr_count_24h: liveRow.coding_pr_count_24h,
					// `last_seen` from the live recompute reflects the
					// most recent span inside the user's window; reuse
					// it so the "Last seen" column doesn't show a
					// timestamp from outside the filter.
					last_seen: liveRow.last_seen || rows[i].last_seen,
				};
			}
		} catch (err) {
			agentsLogger.error("list_agents_coding_overlay_failed", {
				err: String(err),
			});
		}
	}
	return { data: rows, nextCursor };
}

export interface GetAgentParams {
	agentKey: string;
	dbConfigId?: string;
}

export async function getAgent({
	agentKey,
	dbConfigId,
}: GetAgentParams): Promise<UnifiedAgent | null> {
	const cacheKey = `agents:detail:${dbConfigId || "default"}:${agentKey}`;
	return swr(cacheKey, POLICY_DETAIL, async () => loadAgent(agentKey, dbConfigId));
}

async function loadAgent(
	agentKey: string,
	dbConfigId?: string
): Promise<UnifiedAgent | null> {
	const query = `
		${ROLLUP_CTES}
		SELECT ${SELECT_COLUMNS}
		FROM ${AGENTS_SUMMARY_TABLE} AS s FINAL
		${ROLLUP_JOINS}
		WHERE s.agent_key = '${escape(agentKey)}'
		LIMIT 1
		SETTINGS join_use_nulls = 1
	`;
	const res = await dataCollector({ query }, "query", dbConfigId);
	if (res.err) {
		agentsLogger.error("get_agent_failed", {
			err: res.err,
			agentKey,
		});
		return null;
	}
	const rows = (res.data as Record<string, unknown>[]) || [];
	if (!rows.length) return null;
	return rowToAgent(rows[0]);
}

/** Drop the cached detail row for an agent so the next read is fresh. */
export function invalidateAgent(agentKey: string, dbConfigId?: string) {
	invalidate(`agents:detail:${dbConfigId || "default"}:${agentKey}`);
}

/**
 * Compute the deterministic agent_key used as the URL slug + primary key.
 * Matches the formula used by the materializer.
 */
export function computeAgentKey(
	clusterId: string,
	environment: string,
	serviceName: string
): string {
	const cluster = clusterId || "default";
	const env = environment || "default";
	return createHash("sha1")
		.update(`${cluster}|${env}|${serviceName}`)
		.digest("hex")
		.slice(0, 16);
}
