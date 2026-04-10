import {
	getControllerInstanceById,
	getServiceById,
	queueAction,
	updateDesiredStatus,
} from "@/lib/platform/controller";
import type { PythonSDKActionPayload } from "@/types/controller";

function capabilityForMode(mode: string | undefined) {
	switch (mode) {
		case "kubernetes":
			return "python_sdk_injection_kubernetes_v1";
		case "docker":
			return "python_sdk_injection_docker_v1";
		case "linux":
			return "python_sdk_injection_linux_systemd_v1";
		default:
			return "";
	}
}

function preflightReasonForMode(mode: string, supportsPythonSDK: boolean) {
	if (supportsPythonSDK) return "";
	switch (mode) {
		case "docker":
			return "Docker Agent Observability requires a writable Docker socket and a Docker-capable controller.";
		case "linux":
			return "Linux Agent Observability requires a controller with systemd management support.";
		default:
			return "Selected controller does not advertise Agent Observability support for this mode yet.";
	}
}

async function getService(params: Promise<{ id: string }>) {
	const { id } = await params;

	const serviceRes = await getServiceById(id);
	if (!serviceRes.data || serviceRes.data.length === 0) {
		return {
			error: Response.json({ error: "Service not found" }, { status: 404 }),
		};
	}

	const service = serviceRes.data[0];
	if (service.language_runtime !== "python") {
		return {
			error: Response.json(
				{
					error:
						"Agent observability is only available for Python services.",
				},
				{ status: 400 }
			),
		};
	}

	const instanceRes = await getControllerInstanceById(
		service.controller_instance_id
	);
	const instance = instanceRes.data?.[0];
	const expectedCapability = capabilityForMode(instance?.mode);
	const capabilities =
		instance?.resource_attributes?.["controller.capabilities"] || "";
	const supportsPythonSDK = capabilities
		.split(",")
		.map((item) => item.trim())
		.includes(expectedCapability);

	return { service, supportsPythonSDK, mode: instance?.mode || "linux" };
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const result = await getService(params);
		if ("error" in result) return result.error;
		const attrs = result.service.resource_attributes || {};
		const status = attrs["openlit.agent_observability.status"] || "disabled";
		const source = attrs["openlit.agent_observability.source"] || "none";
		const desiredStatus = attrs["openlit.agent_observability.desired_status"] || "";
		let reason =
			attrs["openlit.observability.reason"] ||
			(result.service.language_runtime === "python"
				? "Python runtime detected but OpenLIT Python SDK not enabled"
				: "Agent observability is only available for Python services");
		const conflict = attrs["openlit.observability.conflict"] || "";
		let automatable = result.supportsPythonSDK;
		const isContainerized = attrs["openlit.is_containerized"] === "true";
		if (result.mode === "linux" && attrs["systemd.scope"] === "user") {
			automatable = false;
			reason = "User-scoped systemd services are not supported yet.";
		}
		if (result.mode === "docker" && !attrs["container.id"]) {
			automatable = false;
			reason = "Docker container metadata is missing for this workload.";
		}
		if (status === "enabled" && source === "existing_openlit") {
			automatable = false;
			reason =
				"Existing OpenLIT instrumentation was detected, but it is not controller-managed and will not be removed automatically.";
		}
		if (!automatable && !attrs["openlit.observability.reason"]) {
			reason = preflightReasonForMode(result.mode, result.supportsPythonSDK) || reason;
		}

		const transitioning = desiredStatus !== "" && desiredStatus !== status;
		const workloadKind = attrs["k8s.workload.kind"] || "";
		const isNakedPod = result.mode === "kubernetes" && (!workloadKind || workloadKind === "Pod");

		const isManual = status === "manual" || desiredStatus === "manual";

		return Response.json({
			enabled: status === "enabled" || status === "manual",
			supported: result.service.language_runtime === "python",
			automatable,
			mode: result.mode,
			status,
			desired_status: desiredStatus || null,
			transitioning,
			source,
			conflict,
			reason,
			service: result.service.service_name,
			namespace: result.service.namespace || "default",
			workload_kind: workloadKind || null,
			is_naked_pod: isNakedPod,
			is_manual: isManual,
			is_containerized: isContainerized,
		});
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Agent instrumentation lookup failed" },
			{ status: 500 }
		);
	}
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const serviceContext = await getService(params);
		if ("error" in serviceContext) return serviceContext.error;
		if (!serviceContext.supportsPythonSDK) {
			return Response.json(
				{
					error:
						"Selected controller does not advertise Agent Observability support for this mode yet.",
				},
				{ status: 409 }
			);
		}

		const body = await request.json().catch(() => ({}));
		if (!serviceContext.service.workload_key) {
			return Response.json(
				{ error: "Service is missing workload_key" },
				{ status: 500 }
			);
		}

		const payload: PythonSDKActionPayload = {
			target_runtime: "python",
			instrumentation_profile: "controller_managed",
			duplicate_policy: "block_if_existing_otel_detected",
			observability_scope: "agent",
			otlp_endpoint: body?.otlp_endpoint || null,
			enable_http_instrumentation: body?.enable_http_instrumentation ?? true,
			resource_attributes: {
				"service.workload.key": serviceContext.service.workload_key,
			},
		};

		await updateDesiredStatus(serviceContext.service.workload_key, serviceContext.service.cluster_id || "default", {
			desired_agent_status: "enabled",
		});

		await queueAction(
			serviceContext.service.controller_instance_id,
			"enable_python_sdk",
			serviceContext.service.workload_key,
			JSON.stringify(payload)
		);

		return Response.json({
			status: "queued",
			message:
				"Controller-managed Python SDK rollout queued. Workload-level changes will be applied on the next controller poll.",
			service: serviceContext.service.service_name,
			namespace: serviceContext.service.namespace || "default",
		});
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Agent instrumentation failed" },
			{ status: 500 }
		);
	}
}

export async function DELETE(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const result = await getService(params);
		if ("error" in result) return result.error;
		if (!result.supportsPythonSDK) {
			return Response.json(
				{
					error:
						"Selected controller does not advertise Agent Observability support for this mode yet.",
				},
				{ status: 409 }
			);
		}
		if (!result.service.workload_key) {
			return Response.json(
				{ error: "Service is missing workload_key" },
				{ status: 500 }
			);
		}

		await updateDesiredStatus(result.service.workload_key, result.service.cluster_id || "default", {
			desired_agent_status: "none",
		});

		await queueAction(
			result.service.controller_instance_id,
			"disable_python_sdk",
			result.service.workload_key,
			JSON.stringify({
				target_runtime: "python",
				instrumentation_profile: "controller_managed",
				duplicate_policy: "block_if_existing_otel_detected",
				observability_scope: "agent",
			} satisfies PythonSDKActionPayload)
		);

		return Response.json({
			status: "queued",
			message: "Controller-managed Python SDK removal queued.",
			service: result.service.service_name,
			namespace: result.service.namespace || "default",
		});
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Agent instrumentation delete failed" },
			{ status: 500 }
		);
	}
}
