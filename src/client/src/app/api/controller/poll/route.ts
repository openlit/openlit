import {
	upsertControllerInstance,
	upsertServices,
	getControllerConfig,
	getControllerInstanceById,
	getPendingActions,
	markActionsAcknowledged,
	completeAction,
	getConfigHash,
	queueAction,
	getActionsByIds,
	getFeatureDesiredStates,
	getEnvironmentFeatureConfigs,
	updateFeatureDesiredState,
} from "@/lib/platform/controller";
import { KNOWN_ACTIONS } from "@/types/controller";
import { getAllFeatureHandlers } from "@/lib/platform/controller/features";
import type { ReportedService } from "@/lib/platform/controller/features";
import { getAPIKeyInfo, hasAnyAPIKeys } from "@/lib/platform/api-keys";
import { getFirstDBConfig } from "@/lib/db-config";
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

	// Auth model (intentional, for fast onboarding):
	//   - If any API key exists, the controller MUST send a valid one.
	//   - If no API key has been created yet, the controller may poll without
	//     one so it can come up before the operator finishes onboarding. The
	//     moment the first key is created, this path closes automatically.
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
			{ error: "No database configuration found. Complete onboarding first." },
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

	// Coerce/validate untrusted poll fields into known types/sizes before insert.
	// The body is attacker-influenceable; downstream code (and queries) assume
	// these are strings, so a non-string or oversized value must be normalized.
	const MAX_FIELD = 1024;
	const cStr = (v: unknown): string =>
		(typeof v === "string" ? v : v == null ? "" : String(v))
			// eslint-disable-next-line no-control-regex
			.replace(/[\x00-\x1f\x7f]/g, "")
			.slice(0, MAX_FIELD);
	const cStrArr = (v: unknown): string[] =>
		Array.isArray(v) ? v.slice(0, 256).map(cStr).filter(Boolean) : [];

	const rows = body.services.map((svc: any) => {
		const workloadKey = cStr(svc?.workload_key);
		if (!workloadKey) {
			throw new Error("controller poll: service is missing workload_key");
		}
		const ns = cStr(svc.namespace);
		const name = cStr(svc.service_name);
		const status = cStr(svc.instrumentation_status) || "discovered";

		// resource_attributes: keep only string->string entries.
		const rawAttrs =
			svc.resource_attributes && typeof svc.resource_attributes === "object"
				? (svc.resource_attributes as Record<string, unknown>)
				: {};
		const attrs: Record<string, string> = {};
		for (const k of Object.keys(rawAttrs).slice(0, 128)) {
			attrs[cStr(k)] = cStr(rawAttrs[k]);
		}

		const openPorts = Array.isArray(svc.open_ports)
			? svc.open_ports
					.map((p: unknown) => Number(p))
					.filter((p: number) => Number.isInteger(p) && p > 0 && p <= 65535)
					.slice(0, 64)
			: [];
		const pid = Number.isInteger(svc.pid) && svc.pid > 0 ? svc.pid : 0;

		reportedServices.push({
			workload_key: workloadKey,
			instrumentation_status: status,
			resource_attributes: attrs,
		});

		return {
			id: deterministicServiceId(body.instance_id, workloadKey, ns, name),
			controller_instance_id: body.instance_id,
			cluster_id: clusterId,
			service_name: name,
			workload_key: workloadKey,
			namespace: ns,
			language_runtime: cStr(svc.language_runtime),
			llm_providers: cStrArr(svc.llm_providers),
			open_ports: openPorts,
			deployment_name: cStr(svc.deployment_name),
			pid,
			exe_path: cStr(svc.exe_path),
			instrumentation_status: status,
			resource_attributes: attrs,
			first_seen: cStr(svc.first_seen) || now,
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

/**
 * Persist any lifecycle-Stop snapshots reported by the controller into
 * the matching desired_states_v2.config row, keyed by
 * (workload_key, cluster_id, feature='lifecycle'). Without this step
 * the saved-state blob the controller computed at Stop time (pod spec /
 * exe+cmdline+cwd+env for bare processes) would be lost, and a later
 * Play would have nothing to recreate the workload with.
 *
 * Only completed stop_workload actions with a non-empty snapshot are
 * persisted. Other action types are ignored here -- the standard
 * completeAction path still runs for them.
 *
 * Returns the set of action_ids whose snapshot write failed, so the
 * caller can defer their completeAction and let the controller retry
 * Stop on the next poll. Controller-side stops are idempotent (the pod
 * is already gone / process already dead) so a retry is safe; the
 * value is that we get another chance to capture the snapshot. The
 * snapshot itself was computed pre-destructively so the controller has
 * it in memory only for the lifetime of this RPC, not on retry -- but
 * the dashboard-side write being retried gives the most common
 * failure (transient ClickHouse) a chance to recover without losing
 * the blob.
 */
async function persistLifecycleStopSnapshots(
	actionResults: any[],
	instanceId: string,
	dbId: string
): Promise<Set<string>> {
	const failed = new Set<string>();
	const candidates = actionResults.filter(
		(ar) =>
			ar?.action_id &&
			ar.status === "completed" &&
			typeof ar.snapshot === "string" &&
			ar.snapshot.length > 0 &&
			ar.snapshot !== "{}"
	);
	if (candidates.length === 0) return failed;

	const actionIds = candidates.map((ar) => ar.action_id as string);
	const [actionsRes, instanceRes] = await Promise.all([
		getActionsByIds(actionIds, instanceId, dbId),
		getControllerInstanceById(instanceId, dbId),
	]);

	if (actionsRes.err || !actionsRes.data) {
		console.error(
			"controller poll: getActionsByIds failed; deferring snapshot persistence:",
			sanitizeLogValue(actionsRes.err || "no data")
		);
		// Defer ALL candidate completions so the controller will retry
		// Stop on the next poll, giving us another shot at the lookup.
		for (const ar of candidates) failed.add(ar.action_id as string);
		return failed;
	}
	// Symmetric: an instance lookup failure must defer the same way the
	// actions lookup does. Falling back to cluster_id="default" would
	// silently write the snapshot into the wrong (workload_key,
	// cluster_id) row in multi-cluster setups, so a later Start in the
	// real cluster would see no snapshot and 409. Defer + retry instead.
	if (instanceRes.err || !instanceRes.data?.[0]?.cluster_id) {
		// instanceId rides in on the controller's poll request body, so
		// it must be sanitized before being logged. We use
		// `JSON.stringify` rather than the project's `sanitizeLogValue`
		// helper or an inline regex replace because CodeQL's
		// `js/log-injection` query has a built-in `JsonStringifySanitizer`
		// barrier — using exactly the pattern the analyzer expects keeps
		// future alerts from re-firing on this site. `JSON.stringify`
		// escapes CR/LF (`\\n`, `\\r`) so log forgery via embedded
		// newlines is impossible.
		console.error(
			"controller poll: getControllerInstanceById failed; deferring snapshot persistence:",
			"instance",
			JSON.stringify(instanceId),
			":",
			sanitizeLogValue(instanceRes.err || "no data")
		);
		for (const ar of candidates) failed.add(ar.action_id as string);
		return failed;
	}
	const clusterId = instanceRes.data[0].cluster_id;
	const actionById = new Map(
		actionsRes.data.map((a) => [a.id, a] as const)
	);

	// Run the writes in parallel — they target independent
	// (workload_key, cluster_id) rows so ReplacingMergeTree merges are
	// non-conflicting, and at typical scale we can have dozens of Stops
	// in a single poll cycle (e.g. operator stopping a whole namespace).
	await Promise.all(
		candidates.map(async (ar) => {
			const action = actionById.get(ar.action_id);
			if (!action) return;
			if (action.action_type !== KNOWN_ACTIONS.STOP_WORKLOAD) return;

			const writeRes = await updateFeatureDesiredState(
				action.service_key,
				clusterId,
				"lifecycle",
				"stopped",
				ar.snapshot as string,
				dbId
			);
			if (writeRes?.err) {
				// Same rationale as the instance-lookup branch above:
				// ar.action_id and action.service_key both originate in
				// the controller's poll request body, so we route them
				// through `JSON.stringify` — CodeQL's
				// `JsonStringifySanitizer` barrier. `writeRes.err` is a
				// DB error string (not user input), so passing it
				// through `sanitizeLogValue` is sufficient.
				console.error(
					"controller poll: persist lifecycle snapshot failed for action",
					JSON.stringify(ar.action_id),
					"workload",
					JSON.stringify(action.service_key),
					":",
					sanitizeLogValue(writeRes.err)
				);
				failed.add(ar.action_id);
			}
		})
	);
	return failed;
}

async function phaseProcessActionResults(
	actionResults: any[] | undefined,
	instanceId: string,
	dbId: string
) {
	if (!Array.isArray(actionResults)) return;

	// Persist Stop snapshots BEFORE marking the action complete. If we
	// reordered these, a controller crash between completeAction and the
	// snapshot write would leave us with a successful stop_workload that
	// has no recovery blob, breaking Play for naked pods / bare
	// processes. Writing the snapshot first means completeAction is the
	// commit point, and a write failure defers completeAction so the
	// controller retries Stop on the next poll.
	const deferred = await persistLifecycleStopSnapshots(
		actionResults,
		instanceId,
		dbId
	);

	// completeAction calls run in parallel as well — each row in
	// openlit_controller_actions is identified by a deterministic id so
	// re-inserts deduplicate via ReplacingMergeTree. Parallelizing here
	// keeps the poll round-trip O(slowest write) rather than O(N).
	await Promise.all(
		actionResults.map(async (ar) => {
			if (!ar.action_id || !ar.status) return;
			if (deferred.has(ar.action_id)) return;
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
		})
	);
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
		if (typeof body.instance_id !== "string" || body.instance_id.length > 256) {
			return Response.json(
				{ error: "invalid instance_id" },
				{ status: 400 }
			);
		}
		if (Array.isArray(body.services) && body.services.length > 500) {
			return Response.json(
				{ error: "too many services (max 500)" },
				{ status: 400 }
			);
		}
		if (Array.isArray(body.action_results) && body.action_results.length > 200) {
			return Response.json(
				{ error: "too many action_results (max 200)" },
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
