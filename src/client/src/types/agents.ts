/**
 * Unified Agents types — shared between controller-discovered services and
 * SDK-instrumented apps. The agents page lists both kinds together and the
 * detail page renders the same layout for both, branching only on whether a
 * controller can act on the row.
 */

/**
 * Where this agent originated from:
 *  - `controller`  — discovered by the OpenLit controller (Docker/K8s/systemd).
 *  - `sdk`         — instrumented via openlit-sdk in user code.
 *  - `both`        — discovered AND instrumented (`controller` + `sdk` rolled up).
 *  - `coding`      — AI coding-agent client (Claude Code, Cursor, Codex, …)
 *                    sending telemetry through the openlit CLI's hook
 *                    subcommand. Distinguished here because the
 *                    detail page renders a different set of tabs and the
 *                    list page shows a vendor logo + label.
 */
export type AgentSource = "controller" | "sdk" | "both" | "coding";

/**
 * Vendor identifier for `source === "coding"` rows. Mirrors
 * `coding_agent.client` / `gen_ai.agent.name` from sdk/go/semconv.
 */
export type CodingAgentVendor =
	| "claude-code"
	| "cursor"
	| "codex"
	| "windsurf";

export type AgentInstrumentationStatus = "discovered" | "instrumented";

export interface UnifiedAgent {
	agent_key: string;
	service_name: string;
	environment: string;
	cluster_id: string;
	/**
	 * Mode-specific stable identifier of the running workload — `docker:<container>`,
	 * `k8s:<ns>:<deployment-or-pod>:<container>`, or `linux:systemd:<unit>`.
	 *
	 * Set on every controller-discovered row. SDK rows carry it too once the
	 * controller has injected `OTEL_RESOURCE_ATTRIBUTES=service.workload.key=<key>`
	 * into the SDK process. Pure SDK-only services (no controller managing them)
	 * report this empty.
	 *
	 * Read-path joins for desired-state, pod counts, and action queue all key
	 * off this column on the summary table so they survive controller heartbeat
	 * lag.
	 */
	workload_key: string;
	source: AgentSource;

	/** Set when the agent is backed by a controller row; null otherwise. */
	controller_service_id: string | null;
	controller_instance_id: string | null;

	primary_model: string;
	models: string[];
	providers: string[];
	tool_names: string[];
	tool_count: number;
	request_count_24h: number;

	current_version_hash: string;
	current_version_number: number;

	sdk_version: string;
	sdk_language: string;

	/** Mirrored from the controller row when applicable. */
	instrumentation_status: AgentInstrumentationStatus;
	/**
	 * Desired state and the current pending action are not stored on the
	 * summary row — they're rolled up from `openlit_controller_desired_states_v2`
	 * and `openlit_controller_actions` at read time in `lib/platform/agents`.
	 * Treat the fields here as the rollup output, not summary truth.
	 */
	desired_instrumentation_status: "none" | "instrumented";
	agent_observability_status: "enabled" | "disabled" | "manual" | "";
	desired_agent_status: "none" | "enabled";
	/**
	 * Current lifecycle state of the workload, rolled up from
	 * `resource_attributes['openlit.lifecycle.status']` on
	 * `openlit_controller_services` plus the matching
	 * `feature='lifecycle'` row in `openlit_controller_desired_states_v2`.
	 *
	 * - `running`: the controller's heartbeat reports the workload as up.
	 * - `stopped`: the user clicked Stop and the workload is scaled down.
	 *   The row is still surfaced because the controller's desired-state
	 *   table holds `desired_status='stopped'` indefinitely (up to the
	 *   90-day TTL) so the agent does not disappear from the list.
	 * - `restarting`: a Restart action is in flight.
	 * - `unknown`: SDK-only agents or rows the controller hasn't reported on.
	 */
	lifecycle_status: "running" | "stopped" | "restarting" | "unknown";
	/**
	 * Mirrors `agent_observability` desired-state shape so the UI can compare
	 * actual vs desired and render transition states identically.
	 */
	desired_lifecycle_status: "running" | "stopped" | "unknown";
	pending_action: string | null;
	pending_action_status: "pending" | "acknowledged" | null;

	first_seen: string;
	last_seen: string;
	updated_at: string;
	last_materialized_at: string;

	/**
	 * Multi-pod rollup of the controller's action queue for this workload.
	 * Provided so the UI can show `Pods: ack/total` while an enable/disable
	 * propagates across a fleet (one click → N pod-actions). All three are
	 * 0 for SDK-only rows or when no recent action is queued.
	 */
	pods_total: number;
	pods_pending: number;
	pods_acknowledged: number;

	/**
	 * Coding-agent vendor identifier. Set iff `source === "coding"`. Used by
	 * the list page to render the vendor logo and by the detail page to
	 * branch into the coding-agent tab set.
	 */
	coding_agent_vendor?: CodingAgentVendor;

	/**
	 * Per-coding-agent rollups (last 24h, materialized server-side). All
	 * fields default to 0 for non-coding rows so dashboard widgets can
	 * filter on `source = 'coding'` without conditionalizing every read.
	 */
	coding_session_count_24h?: number;
	coding_cost_usd_24h?: number;
	coding_active_users_24h?: number;
	/**
	 * Code-impact rollups (last 24h). `lines_*` are LOC sums across
	 * accepted/rejected/total edits; `edit_*` are decision counts that
	 * power the acceptance % derivation. `commit_count_24h` and
	 * `pr_count_24h` come from detected `git commit` / `gh pr`
	 * invocations parsed out of shell/Bash hooks. All default to 0
	 * for non-coding rows.
	 */
	coding_lines_added_24h?: number;
	coding_lines_removed_24h?: number;
	coding_lines_accepted_24h?: number;
	coding_lines_rejected_24h?: number;
	coding_edit_accept_24h?: number;
	coding_edit_reject_24h?: number;
	coding_commit_count_24h?: number;
	coding_pr_count_24h?: number;
}

export interface AgentListCursor {
	last_seen: string;
	agent_key: string;
}

export interface AgentListResponse {
	data: UnifiedAgent[];
	nextCursor: AgentListCursor | null;
}

export interface AgentTool {
	name: string;
	description: string;
	schema: unknown;
}

export interface AgentVersion {
	agent_key: string;
	version_hash: string;
	version_number: number;
	system_prompt: string;
	tools: AgentTool[];
	primary_model: string;
	models: string[];
	providers: string[];
	runtime_config: AgentRuntimeConfig;
	first_seen: string;
	last_seen: string;
	request_count: number;
	updated_at: string;
}

export interface AgentRuntimeConfig {
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	provider?: string;
}

/** Snapshot derived from the last N minutes of traces, before version upsert. */
export interface AgentSnapshot {
	agent_key: string;
	service_name: string;
	environment: string;
	cluster_id: string;
	system_prompt: string;
	tools: AgentTool[];
	primary_model: string;
	models: string[];
	providers: string[];
	runtime_config: AgentRuntimeConfig;
	request_count: number;
	first_seen: string;
	last_seen: string;
	version_hash: string;
}

export interface AgentListFilters {
	source?: AgentSource[];
	environments?: string[];
	providers?: string[];
	statuses?: Array<"discovered" | "instrumented" | "sdk">;
	codingVendors?: CodingAgentVendor[];
}
