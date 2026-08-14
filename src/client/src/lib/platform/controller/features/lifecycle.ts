/**
 * Lifecycle feature handler — drives Play / Stop / Restart for
 * controller-managed workloads.
 *
 * The handler is the dashboard-side mirror of openlit-controller's
 * engine/lifecycle.go. It only writes desired state + queues the action;
 * the controller does the actual work. The actual workload status comes
 * back to the dashboard through two channels:
 *   1. The controller's next heartbeat reports
 *      resource_attributes["openlit.lifecycle.status"]. That feeds the
 *      pod_set rollup in lib/platform/agents/index.ts.
 *   2. For Stop, the controller's ActionResult carries a snapshot blob
 *      (pod spec for K8s naked pods, exe+cmdline+cwd+env-subset for bare
 *      Linux processes). The poll route persists the blob into
 *      desired_states_v2.config so a later Start can hand it back.
 *
 * The Restart path is *one-shot* on the reconcile loop: clicking Restart
 * does NOT change desired_status (it stays 'running'), and we never emit
 * a restart action from reconcile() — only directly from applyOperation.
 * That prevents the reconciler from looping forever on Restart desired-
 * vs-actual mismatches that have no closed-form fix.
 */

import {
	getServiceById,
	getControllerInstanceById,
	getControllerIdsForWorkload,
	getFeatureDesiredStates,
	queueAction,
	updateFeatureDesiredState,
} from "@/lib/platform/controller";
import { KNOWN_ACTIONS } from "@/types/controller";
import type {
	FeatureDesiredState,
	EnvironmentFeatureConfig,
} from "@/types/controller";
import type {
	FeatureHandler,
	ReportedService,
	ReconcileAction,
} from "./registry";
import { registerFeature } from "./registry";

const FEATURE = "lifecycle";

const DESIRED_RUNNING = "running";
const DESIRED_STOPPED = "stopped";

/**
 * The controller advertises its per-mode lifecycle support via the
 * `controller.capabilities` resource attribute (see
 * engine.go::ControllerCapabilities). Modes that do not appear here mean
 * the dashboard should not let the user click Play/Stop/Restart for
 * workloads attached to that controller — the action would be queued
 * but the Go engine would have nothing to do with it.
 */
function capabilityForMode(mode: string | undefined): { value: string; prefix: boolean } {
	switch (mode) {
		case "kubernetes":
			return { value: "lifecycle_kubernetes_v1", prefix: false };
		case "docker":
			return { value: "lifecycle_docker_v1", prefix: false };
		case "linux":
			return { value: "lifecycle_linux_", prefix: true };
		default:
			return { value: "", prefix: false };
	}
}

async function resolveLifecycleContext(
	serviceId: string,
	dbConfigId?: string
): Promise<
	| { error: Response }
	| {
			service: any;
			supportsLifecycle: boolean;
			mode: string;
			targets: string[];
	  }
> {
	const serviceRes = await getServiceById(serviceId, dbConfigId);
	if (!serviceRes.data || serviceRes.data.length === 0) {
		return { error: Response.json({ error: "Service not found" }, { status: 404 }) };
	}
	const service = serviceRes.data[0];
	if (!service.workload_key) {
		return {
			error: Response.json(
				{ error: "Service is missing workload_key" },
				{ status: 500 }
			),
		};
	}

	const instanceRes = await getControllerInstanceById(
		service.controller_instance_id,
		dbConfigId
	);
	const instance = instanceRes.data?.[0];
	const mode = instance?.mode || "linux";
	const expected = capabilityForMode(mode);
	const capabilities =
		instance?.resource_attributes?.["controller.capabilities"] || "";
	const supportsLifecycle = capabilities
		.split(",")
		.map((cap) => cap.trim())
		.some((cap) =>
			expected.prefix
				? cap.startsWith(expected.value)
				: cap === expected.value
		);

	// Multi-controller fan-out: same as instrumentation.ts. For K8s
	// workload-level operations (scale, rollout-restart) the action is
	// idempotent across controllers — atomicScaleWithAnnotation/
	// bumpRolloutAnnotation use resourceVersion-based optimistic
	// concurrency so the second controller's update either no-ops or
	// retries cleanly on conflict. For per-pod operations (naked pods,
	// Linux modes) every owning controller acting against its own pod is
	// the correct behaviour.
	const controllerIds = await getControllerIdsForWorkload(
		service.service_name,
		service.namespace || "",
		service.cluster_id || "default",
		dbConfigId
	);
	const targets =
		controllerIds.data?.map((r) => r.controller_instance_id) || [];
	if (targets.length === 0) {
		targets.push(service.controller_instance_id);
	}

	return { service, supportsLifecycle, mode, targets };
}

const lifecycleHandler: FeatureHandler = {
	feature: FEATURE,

	validatePayload(operation: string, _payload: Record<string, unknown>) {
		if (
			operation !== "start" &&
			operation !== "stop" &&
			operation !== "restart"
		) {
			return `Unknown operation "${operation}" for feature "${FEATURE}". Expected "start", "stop", or "restart".`;
		}
		return null;
	},

	async applyOperation(
		serviceId: string,
		operation: string,
		_payload: Record<string, unknown>,
		dbConfigId?: string
	): Promise<Response> {
		try {
			const ctx = await resolveLifecycleContext(serviceId, dbConfigId);
			if ("error" in ctx) return ctx.error;

			if (!ctx.supportsLifecycle) {
				return Response.json(
					{
						error:
							"The selected controller does not advertise lifecycle support for this mode yet.",
					},
					{ status: 409 }
				);
			}

			const workloadKey = ctx.service.workload_key as string;
			const clusterId = (ctx.service.cluster_id as string) || "default";

			if (operation === "stop") {
				// Write the desired state up-front so the UI sees the
				// stopped intent immediately. The controller will return
				// a snapshot blob on the action result, which the poll
				// route persists into the same row's `config` column so
				// a later Start can hand it back. We deliberately do not
				// require the snapshot at write time -- naked pods and
				// bare processes are the only modes that *need* one, and
				// the controller computes it from local state.
				await updateFeatureDesiredState(
					workloadKey,
					clusterId,
					FEATURE,
					DESIRED_STOPPED,
					"{}",
					dbConfigId
				);
				await Promise.all(
					ctx.targets.map((cid) =>
						queueAction(
							cid,
							KNOWN_ACTIONS.STOP_WORKLOAD,
							workloadKey,
							"{}",
							dbConfigId
						)
					)
				);
				return Response.json({
					status: "queued",
					action: KNOWN_ACTIONS.STOP_WORKLOAD,
					controllers: ctx.targets.length,
				});
			}

			if (operation === "start") {
				// Pull the snapshot stashed by the previous Stop. What
				// the snapshot contains depends on the mode:
				//   - K8s naked pod: full gzipped pod spec (recreated
				//     by the controller).
				//   - Linux bare process: exe + argv + cwd + env
				//     allowlist (re-execed).
				//   - K8s controlled (Deployment/STS/DS): small
				//     {kind, ns, name, container_name} identifier that
				//     lets startK8s scale back up even when the
				//     controller's in-memory svc cache has been pruned.
				//   - Docker, systemd: "{}" — runtime preserves the
				//     object across Stop (container ID / unit file),
				//     no replay data needed.
				const desiredRes = await getFeatureDesiredStates(
					[workloadKey],
					clusterId,
					[FEATURE],
					dbConfigId
				);
				const row = desiredRes.data?.find(
					(r) => r.feature === FEATURE
				);
				const snapshot = row?.config || "{}";

				// If the workload mode requires a snapshot but the
				// desired-states row has none (e.g. controller was
				// upgraded between Stop and Start, or the user clicks
				// Play on a workload that the controller never stopped),
				// fail closed -- the controller would otherwise error
				// when trying to recreate the pod or re-exec the process.
				//
				// Systemd carve-out: Linux *systemd* units do NOT need a
				// snapshot because the unit file still exists on disk
				// and `systemctl start <unit>` is sufficient. Only Linux
				// *bare* processes (no `systemd.unit` resource attr)
				// need the captured exe+argv+cwd+env to re-exec.
				const k8sKind = ctx.service.resource_attributes?.["k8s.workload.kind"];
				const isLinuxBare =
					ctx.mode === "linux" &&
					!ctx.service.resource_attributes?.["systemd.unit"];
				const isK8sNakedPod =
					ctx.mode === "kubernetes" &&
					(k8sKind === "" || k8sKind === "Pod" || k8sKind === undefined);
				const requiresSnapshot = isLinuxBare || isK8sNakedPod;
				if (requiresSnapshot && (!snapshot || snapshot === "{}")) {
					return Response.json(
						{
							error:
								"No saved snapshot is available to bring this workload back up. The controller cannot recreate naked pods or bare processes without a snapshot captured at Stop time.",
						},
						{ status: 409 }
					);
				}

				await updateFeatureDesiredState(
					workloadKey,
					clusterId,
					FEATURE,
					DESIRED_RUNNING,
					snapshot,
					dbConfigId
				);
				await Promise.all(
					ctx.targets.map((cid) =>
						queueAction(
							cid,
							KNOWN_ACTIONS.START_WORKLOAD,
							workloadKey,
							snapshot,
							dbConfigId
						)
					)
				);
				return Response.json({
					status: "queued",
					action: KNOWN_ACTIONS.START_WORKLOAD,
					controllers: ctx.targets.length,
				});
			}

			// Restart: keep desired_status='running' (no flip). We do not
			// touch desired_states here because the reconcile loop must
			// not interpret Restart as a continuous desired-state
			// mismatch.
			await Promise.all(
				ctx.targets.map((cid) =>
					queueAction(
						cid,
						KNOWN_ACTIONS.RESTART_WORKLOAD,
						workloadKey,
						"{}",
						dbConfigId
					)
				)
			);
			return Response.json({
				status: "queued",
				action: KNOWN_ACTIONS.RESTART_WORKLOAD,
				controllers: ctx.targets.length,
			});
		} catch (error: any) {
			return Response.json(
				{ error: error.message || "Lifecycle operation failed" },
				{ status: 500 }
			);
		}
	},

	reconcile(
		reportedServices: ReportedService[],
		desiredStates: Map<string, FeatureDesiredState>,
		_envConfig?: EnvironmentFeatureConfig
	): ReconcileAction[] {
		const actions: ReconcileAction[] = [];

		for (const svc of reportedServices) {
			const desired = desiredStates.get(svc.workload_key);
			if (!desired) continue;

			const actual =
				svc.resource_attributes?.["openlit.lifecycle.status"] ||
				"running";

			if (
				desired.desired_status === DESIRED_RUNNING &&
				actual === "stopped"
			) {
				actions.push({
					actionType: KNOWN_ACTIONS.START_WORKLOAD,
					serviceKey: svc.workload_key,
					payload: desired.config || "{}",
				});
			}
			if (
				desired.desired_status === DESIRED_STOPPED &&
				actual !== "stopped"
			) {
				actions.push({
					actionType: KNOWN_ACTIONS.STOP_WORKLOAD,
					serviceKey: svc.workload_key,
					payload: "{}",
				});
			}
			// Restart is intentionally NOT reconciled. It's a one-shot
			// action queued directly from applyOperation -- a reconcile
			// emission would either loop forever or paper over a genuine
			// stop with a restart.
		}

		return actions;
	},
};

registerFeature(lifecycleHandler);

export default lifecycleHandler;
