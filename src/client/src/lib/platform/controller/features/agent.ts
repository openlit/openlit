import {
	getServiceById,
	getControllerInstanceById,
	getControllerIdsForWorkload,
	getControllerConfig,
	getFeatureDesiredStates,
	queueAction,
	updateFeatureDesiredState,
} from "@/lib/platform/controller";
import { KNOWN_ACTIONS } from "@/types/controller";
import type {
	PythonSDKActionPayload,
	PythonSDKActionRuntime,
	FeatureDesiredState,
	EnvironmentFeatureConfig,
} from "@/types/controller";
import type {
	FeatureHandler,
	ReportedService,
	ReconcileAction,
} from "./registry";
import { registerFeature } from "./registry";

const FEATURE = "agent";

function capabilityForMode(
	mode: string | undefined,
	runtime: string
): { value: string; prefix: boolean } {
	const runtimePrefix = runtime === "nodejs" ? "nodejs_sdk_injection" : "python_sdk_injection";
	switch (mode) {
		case "kubernetes":
			return { value: `${runtimePrefix}_kubernetes_v1`, prefix: false };
		case "docker":
			return { value: `${runtimePrefix}_docker_v1`, prefix: false };
		case "linux":
			return { value: `${runtimePrefix}_linux_`, prefix: true };
		default:
			return { value: "", prefix: false };
	}
}

function isSupportedAgentRuntime(runtime: string): runtime is PythonSDKActionRuntime {
	return runtime === "python" || runtime === "nodejs";
}

function normalizeAgentRuntime(runtime?: string) {
	return runtime === "node" ? "nodejs" : runtime || "python";
}

function runtimeLabel(runtime: string) {
	return normalizeAgentRuntime(runtime) === "nodejs" ? "JavaScript/TypeScript" : "Python";
}

function preflightReasonForMode(mode: string, supportsSDK: boolean, runtime: string) {
	if (supportsSDK) return "";
	switch (mode) {
		case "docker":
			return "Docker Agent Observability requires a writable Docker socket and a Docker-capable controller.";
		case "linux":
			return `Linux Agent Observability requires a supported ${runtimeLabel(runtime)} runtime on the target host.`;
		default:
			return "Selected controller does not advertise Agent Observability support for this mode yet.";
	}
}

async function resolveAgentContext(
	serviceId: string,
	dbConfigId?: string
): Promise<
	| { error: Response }
	| { service: any; supportsPythonSDK: boolean; mode: string; runtime: PythonSDKActionRuntime }
> {
	const serviceRes = await getServiceById(serviceId, dbConfigId);
	if (!serviceRes.data || serviceRes.data.length === 0) {
		return { error: Response.json({ error: "Service not found" }, { status: 404 }) };
	}
	const service = serviceRes.data[0];
	const runtime = normalizeAgentRuntime(service.language_runtime);
	if (!isSupportedAgentRuntime(runtime)) {
		return {
			error: Response.json(
				{ error: "Agent observability is only available for Python and JavaScript/TypeScript services." },
				{ status: 400 }
			),
		};
	}

	const instanceRes = await getControllerInstanceById(
		service.controller_instance_id,
		dbConfigId
	);
	const instance = instanceRes.data?.[0];
	const expected = capabilityForMode(instance?.mode, runtime);
	const capabilities =
		instance?.resource_attributes?.["controller.capabilities"] || "";
	const supportsPythonSDK = capabilities
		.split(",")
		.map((item) => item.trim())
		.some((cap) =>
			expected.prefix
				? cap.startsWith(expected.value)
				: cap === expected.value
		);

	return { service, supportsPythonSDK, mode: instance?.mode || "linux", runtime };
}

export async function buildAgentStatusResponse(
	service: any,
	supportsPythonSDK: boolean,
	mode: string,
	dbConfigId?: string
) {
	const attrs = service.resource_attributes || {};
	const runtime = normalizeAgentRuntime(service.language_runtime);
	const status = attrs["openlit.agent_observability.status"] || "disabled";
	const source = attrs["openlit.agent_observability.source"] || "none";
	// Desired status no longer lives on the service's resource_attributes
	// (the Go controller used to stamp it there as a UI hint). It now comes
	// directly from openlit_controller_desired_states_v2 — single source of
	// truth for both the read path and the rendered toggle.
	let desiredStatus = "";
	if (service.workload_key) {
		const desiredRes = await getFeatureDesiredStates(
			[service.workload_key],
			service.cluster_id || "default",
			[FEATURE],
			dbConfigId
		);
		const row = desiredRes.data?.[0];
		if (row?.desired_status) desiredStatus = row.desired_status;
	}
	let reason =
		attrs["openlit.observability.reason"] ||
		(isSupportedAgentRuntime(runtime)
			? `${runtimeLabel(runtime)} runtime detected but OpenLIT SDK not enabled`
			: "Agent observability is only available for Python and JavaScript/TypeScript services");
	const conflict = attrs["openlit.observability.conflict"] || "";
	let automatable = supportsPythonSDK;
	const isContainerized = attrs["openlit.is_containerized"] === "true";

	if (mode === "linux" && attrs["systemd.scope"] === "user") {
		automatable = false;
		reason = "User-scoped systemd services are not supported yet.";
	}
	if (mode === "docker" && !attrs["container.id"]) {
		automatable = false;
		reason = "Docker container metadata is missing for this workload.";
	}
	if (status === "enabled" && source === "existing_openlit") {
		automatable = false;
		reason =
			"Existing OpenLIT instrumentation was detected, but it is not controller-managed and will not be removed automatically.";
	}
	if (!automatable && !attrs["openlit.observability.reason"]) {
		reason = preflightReasonForMode(mode, supportsPythonSDK, runtime) || reason;
	}

	const transitioning = desiredStatus !== "" && desiredStatus !== status;
	const workloadKind = attrs["k8s.workload.kind"] || "";
	const isNakedPod =
		mode === "kubernetes" && (!workloadKind || workloadKind === "Pod");
	const isManual = status === "manual" || desiredStatus === "manual";

	return {
		enabled: status === "enabled" || status === "manual",
		supported: isSupportedAgentRuntime(runtime),
		automatable,
		mode,
		status,
		desired_status: desiredStatus || null,
		transitioning,
		source,
		conflict,
		reason,
		service: service.service_name,
		namespace: service.namespace || "default",
		workload_kind: workloadKind || null,
		is_naked_pod: isNakedPod,
		is_manual: isManual,
		is_containerized: isContainerized,
	};
}

const agentHandler: FeatureHandler = {
	feature: FEATURE,

	validatePayload(operation: string, _payload: Record<string, unknown>) {
		if (
			operation !== "enable" &&
			operation !== "disable" &&
			operation !== "status"
		) {
			return `Unknown operation "${operation}" for feature "${FEATURE}". Expected "enable", "disable", or "status".`;
		}
		return null;
	},

	async applyOperation(
		serviceId: string,
		operation: string,
		payload: Record<string, unknown>,
		dbConfigId?: string
	): Promise<Response> {
		try {
			const ctx = await resolveAgentContext(serviceId, dbConfigId);
			if ("error" in ctx) return ctx.error;

			if (operation === "status") {
				return Response.json(
					await buildAgentStatusResponse(
						ctx.service,
						ctx.supportsPythonSDK,
						ctx.mode,
						dbConfigId
					)
				);
			}

			if (!ctx.supportsPythonSDK) {
				return Response.json(
					{
						error:
							"Selected controller does not advertise Agent Observability support for this mode yet.",
					},
					{ status: 409 }
				);
			}
			if (!ctx.service.workload_key) {
				return Response.json(
					{ error: "Service is missing workload_key" },
					{ status: 500 }
				);
			}

			const enabling = operation === "enable";

			await updateFeatureDesiredState(
				ctx.service.workload_key,
				ctx.service.cluster_id || "default",
				FEATURE,
				enabling ? "enabled" : "none",
				"{}",
				dbConfigId
			);

			const controllerIds = await getControllerIdsForWorkload(
				ctx.service.service_name,
				ctx.service.namespace || "",
				ctx.service.cluster_id || "default",
				dbConfigId
			);
			const targets =
				controllerIds.data?.map((r) => r.controller_instance_id) || [];
			if (targets.length === 0) {
				targets.push(ctx.service.controller_instance_id);
			}

			let exportOverrides: Partial<PythonSDKActionPayload> = {};
			if (enabling) {
				const cfgRes = await getControllerConfig(
					ctx.service.controller_instance_id,
					dbConfigId
				);
				const raw = cfgRes.data?.[0]?.config;
				if (raw) {
					try {
						const savedCfg = JSON.parse(raw) as import("@/types/controller").ControllerConfig;
						const exp = savedCfg.export;
						if (exp) {
							if (exp.otlp_endpoint) exportOverrides.otlp_endpoint = exp.otlp_endpoint;
							if (exp.otlp_protocol) exportOverrides.otlp_protocol = exp.otlp_protocol;
							if (exp.otlp_headers && Object.keys(exp.otlp_headers).length > 0)
								exportOverrides.otlp_headers = exp.otlp_headers;
							if (exp.otlp_traces_endpoint) exportOverrides.otlp_traces_endpoint = exp.otlp_traces_endpoint;
							if (exp.otlp_metrics_endpoint) exportOverrides.otlp_metrics_endpoint = exp.otlp_metrics_endpoint;
							if (exp.otlp_logs_endpoint) exportOverrides.otlp_logs_endpoint = exp.otlp_logs_endpoint;
						}
					} catch {
						// Config parse failure is non-fatal; the controller will use its defaults.
					}
				}
			}

			const actionPayload: PythonSDKActionPayload = {
				target_runtime: ctx.runtime,
				instrumentation_profile: "controller_managed",
				duplicate_policy: "block_if_existing_otel_detected",
				observability_scope: "agent",
				...(enabling
					? {
							...exportOverrides,
							otlp_endpoint:
								(payload?.otlp_endpoint as string) || exportOverrides.otlp_endpoint || null,
							enable_http_instrumentation:
								(payload?.enable_http_instrumentation as boolean) ??
								true,
							resource_attributes: {
								"service.workload.key":
									ctx.service.workload_key,
							},
						}
					: {}),
			};

			const actionType = enabling
				? KNOWN_ACTIONS.ENABLE_AGENT
				: KNOWN_ACTIONS.DISABLE_AGENT;

			await Promise.all(
				targets.map((cid) =>
					queueAction(
						cid,
						actionType,
						ctx.service.workload_key,
						JSON.stringify(actionPayload),
						dbConfigId
					)
				)
			);

			return Response.json({
				status: "queued",
				message: enabling
					? "Controller-managed OpenLIT SDK rollout queued. Workload-level changes will be applied on the next controller poll."
					: "Controller-managed OpenLIT SDK removal queued.",
				service: ctx.service.service_name,
				namespace: ctx.service.namespace || "default",
				controllers: targets.length,
			});
		} catch (error: any) {
			return Response.json(
				{ error: error.message || "Agent operation failed" },
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
		const defaultPayload = JSON.stringify({
			instrumentation_profile: "controller_managed",
			duplicate_policy: "block_if_existing_otel_detected",
			observability_scope: "agent",
		});

		for (const svc of reportedServices) {
			const desired = desiredStates.get(svc.workload_key);
			if (!desired) continue;
			const runtime = normalizeAgentRuntime(svc.language_runtime);
			if (!isSupportedAgentRuntime(runtime)) continue;

			const agentStatus =
				svc.resource_attributes?.[
					"openlit.agent_observability.status"
				] || "disabled";

			if (
				desired.desired_status === "enabled" &&
				agentStatus !== "enabled"
			) {
				actions.push({
					actionType: KNOWN_ACTIONS.ENABLE_AGENT,
					serviceKey: svc.workload_key,
					payload: desired.config !== "{}" ? desired.config : JSON.stringify({
						...JSON.parse(defaultPayload),
						target_runtime: runtime,
					}),
				});
			}
			if (
				desired.desired_status === "none" &&
				agentStatus === "enabled"
			) {
				actions.push({
					actionType: KNOWN_ACTIONS.DISABLE_AGENT,
					serviceKey: svc.workload_key,
					payload: JSON.stringify({
						...JSON.parse(defaultPayload),
						target_runtime: runtime,
					}),
				});
			}
		}

		return actions;
	},
};

registerFeature(agentHandler);

export default agentHandler;
