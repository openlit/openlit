"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { formatBrowserDateTime } from "@/utils/date";
import { useDynamicBreadcrumbs } from "@/utils/hooks/useBreadcrumbs";
import type { ControllerService, ControllerInstance } from "@/types/controller";
import { toast } from "sonner";
import LinuxSvg from "@/components/svg/linux";
import KubernetesSvg from "@/components/svg/kubernetes";
import DockerSvg from "@/components/svg/docker";
import { ProviderIcon } from "@/components/svg/providers";
import getMessage from "@/constants/messages";

export default function ServiceDetail() {
	const { id } = useParams<{ id: string }>();
	const router = useRouter();

	const {
		fireRequest: fetchService,
		data: service,
		isLoading,
	} = useFetchWrapper<ControllerService>();
	const {
		fireRequest: fetchInstances,
		data: instances,
	} = useFetchWrapper<ControllerInstance[]>();
	const {
		fireRequest: fetchAgentObservability,
		data: agentObservability,
		isFetched: agentObservabilityFetched,
	} = useFetchWrapper<{
		enabled: boolean;
		supported: boolean;
		automatable?: boolean;
		mode: "kubernetes" | "docker" | "linux";
		status: string;
		desired_status: string | null;
		transitioning: boolean;
		source: string;
		conflict?: string;
		reason: string;
		workload_kind?: string | null;
		is_naked_pod?: boolean;
		is_manual?: boolean;
		is_containerized?: boolean;
	}>();
	const { fireRequest: doAction, isLoading: actionLoading } =
		useFetchWrapper();
	const [agentActionPending, setAgentActionPending] = useState(false);
	const [agentLocalIntent, setAgentLocalIntent] = useState<"enabling" | "disabling" | null>(null);
	const agentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const refresh = useCallback(() => {
		fetchService({
			requestType: "GET",
			url: `/api/controller/catalog/${id}`,
			responseDataKey: "data",
		});
		fetchInstances({
			requestType: "GET",
			url: "/api/controller/instances",
			responseDataKey: "data",
		});
	}, [id, fetchService, fetchInstances]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const pendingAction = service?.pending_action || null;
	const isPending =
		service?.pending_action_status === "pending" ||
		service?.pending_action_status === "acknowledged";
	useDynamicBreadcrumbs(
		{
			title: service?.service_name || getMessage().INSTRUMENTATION_HUB_SERVICE_DETAIL_DEFAULT_TITLE,
		},
		[service?.service_name]
	);

	useEffect(() => {
		if (!isPending) return;
		const interval = window.setInterval(() => {
			refresh();
		}, 2500);

		return () => window.clearInterval(interval);
	}, [isPending, refresh]);

	const isInstrumented =
		service?.instrumentation_status === "instrumented" ||
		service?.desired_instrumentation_status === "instrumented";
	const instance = instances?.find(
		(candidate) => candidate.instance_id === service?.controller_instance_id
	);
	const mode = instance?.mode || "linux";
	const isPython = service?.language_runtime === "python";
	const agentObservabilityEnabled = !!agentObservability?.enabled;
	const agentTransitioning =
		agentActionPending || !!agentObservability?.transitioning;
	const agentActionLabel =
		mode === "docker"
			? getMessage().INSTRUMENTATION_HUB_AGENT_ACTION_DOCKER
			: mode === "linux"
				? getMessage().INSTRUMENTATION_HUB_AGENT_ACTION_LINUX
				: getMessage().INSTRUMENTATION_HUB_AGENT_ACTION_K8S;

	useEffect(() => {
		if (!service || !isPython) return;
		fetchAgentObservability({
			requestType: "GET",
			url: `/api/controller/catalog/${id}/agent-instrument`,
		});
	}, [service, isPython, id, fetchAgentObservability]);

	useEffect(() => {
		if (!agentTransitioning) {
			if (agentPollRef.current) {
				clearInterval(agentPollRef.current);
				agentPollRef.current = null;
			}
			if (agentActionPending && agentObservabilityFetched) {
				setAgentActionPending(false);
				setAgentLocalIntent(null);
			}
			return;
		}
		if (agentPollRef.current) return;
		agentPollRef.current = setInterval(() => {
			fetchAgentObservability({
				requestType: "GET",
				url: `/api/controller/catalog/${id}/agent-instrument`,
			});
			refresh();
		}, 3000);
		return () => {
			if (agentPollRef.current) {
				clearInterval(agentPollRef.current);
				agentPollRef.current = null;
			}
		};
	}, [agentTransitioning, agentActionPending, agentObservabilityFetched, id, fetchAgentObservability, refresh]);

	const toggleInstrumentation = async () => {
		const action = isInstrumented ? "uninstrument" : "instrument";
		await doAction({
			requestType: "POST",
			url: `/api/controller/catalog/${id}/${action}`,
			successCb: () => {
				toast.success(
					getMessage().INSTRUMENTATION_HUB_QUEUED_ACTION(action)
				);
				refresh();
			},
			failureCb: (err: any) => {
				toast.error(getMessage().INSTRUMENTATION_HUB_SERVICE_FAILED(err));
			},
		});
	};

	const toggleAgentObservability = async () => {
		const enabling = !agentObservabilityEnabled;
		if (enabling && agentObservability?.is_naked_pod) {
			const confirmed = window.confirm(
				getMessage().INSTRUMENTATION_HUB_NAKED_POD_CONFIRM
			);
			if (!confirmed) return;
		}
		const requestType = enabling ? "POST" : "DELETE";
		setAgentLocalIntent(enabling ? "enabling" : "disabling");
		await doAction({
			requestType,
			url: `/api/controller/catalog/${id}/agent-instrument`,
			successCb: () => {
				setAgentActionPending(true);
				toast.success(
					enabling
						? getMessage().INSTRUMENTATION_HUB_AGENT_DEPLOY_QUEUED
						: getMessage().INSTRUMENTATION_HUB_AGENT_REMOVE_QUEUED
				);
				fetchAgentObservability({
					requestType: "GET",
					url: `/api/controller/catalog/${id}/agent-instrument`,
				});
			},
			failureCb: (err: any) => {
				toast.error(getMessage().INSTRUMENTATION_HUB_SERVICE_FAILED(err));
				setAgentLocalIntent(null);
			},
		});
	};

	const formatProviderLabel = (provider: string) =>
		provider.replaceAll("_", " ");

	const pendingActionLabel = (action?: string | null) => {
		switch (action) {
			case "instrument":
				return getMessage().INSTRUMENTATION_HUB_PENDING_INSTRUMENTING;
			case "uninstrument":
				return getMessage().INSTRUMENTATION_HUB_PENDING_UNINSTRUMENTING;
			case "enable_python_sdk":
				return getMessage().INSTRUMENTATION_HUB_PENDING_ENABLING_AGENT;
			case "disable_python_sdk":
				return getMessage().INSTRUMENTATION_HUB_PENDING_DISABLING_AGENT;
			default:
				return getMessage().INSTRUMENTATION_HUB_PENDING_WORKING;
		}
	};
	const agentReasonText = agentObservability?.reason
		? `${agentObservability.reason}. `
		: "";
	const agentToggleLabel = () => {
		if (!agentObservabilityFetched) return getMessage().INSTRUMENTATION_HUB_AGENT_TOGGLE_CHECKING;
		if (agentTransitioning) {
			if (agentLocalIntent === "enabling") return getMessage().INSTRUMENTATION_HUB_AGENT_TOGGLE_DEPLOYING;
			if (agentLocalIntent === "disabling") return getMessage().INSTRUMENTATION_HUB_AGENT_TOGGLE_REMOVING;
			return agentObservability?.desired_status === "enabled"
				? getMessage().INSTRUMENTATION_HUB_AGENT_TOGGLE_DEPLOYING
				: getMessage().INSTRUMENTATION_HUB_AGENT_TOGGLE_REMOVING;
		}
		if (agentObservability?.conflict === "existing_otel") return getMessage().INSTRUMENTATION_HUB_AGENT_TOGGLE_CONFLICT;
		if (agentObservability?.automatable === false) {
			if (!agentObservability?.reason) return getMessage().INSTRUMENTATION_HUB_AGENT_TOGGLE_UNAVAILABLE;
			if (agentObservability.reason.includes("writable Docker socket")) {
				return getMessage().INSTRUMENTATION_HUB_AGENT_TOGGLE_DOCKER_NEEDED;
			}
			if (agentObservability.reason.includes("systemd")) {
				return getMessage().INSTRUMENTATION_HUB_AGENT_TOGGLE_NOT_MANAGEABLE;
			}
			if (agentObservability.reason.includes("advertise")) {
				return getMessage().INSTRUMENTATION_HUB_AGENT_TOGGLE_CONTROLLER_UPGRADE;
			}
			return getMessage().INSTRUMENTATION_HUB_AGENT_TOGGLE_UNAVAILABLE;
		}
		return agentObservabilityEnabled ? getMessage().INSTRUMENTATION_HUB_SERVICE_ACTION_DISABLE : getMessage().INSTRUMENTATION_HUB_SERVICE_ACTION_ENABLE;
	};

	if (isLoading || !service) {
		return (
			<div className="flex items-center justify-center w-full py-16">
				<div className="text-stone-400">{getMessage().INSTRUMENTATION_HUB_LOADING_SERVICE_DETAILS}</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col w-full gap-4 p-1 overflow-y-auto">
			<button
				onClick={() => router.push("/instrumentation-hub")}
				className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 w-fit transition-colors"
			>
				<ArrowLeft className="w-4 h-4" />
				{getMessage().INSTRUMENTATION_HUB_BACK_TO_HUB}
			</button>

			<div className="border dark:border-stone-800 rounded-lg p-6">
				<div className="flex items-start justify-between">
					<div className="flex items-start gap-4">
						<div className="w-10 h-10 bg-stone-200 dark:bg-stone-700 rounded-full flex items-center justify-center">
							{mode === "kubernetes" ? (
								<KubernetesSvg className="w-5 h-5 text-stone-600 dark:text-stone-300" />
							) : mode === "docker" ? (
								<DockerSvg className="w-5 h-5 text-stone-600 dark:text-stone-300" />
							) : (
								<LinuxSvg className="w-5 h-5 text-stone-600 dark:text-stone-300" />
							)}
						</div>
						<div>
							<h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
								{service.service_name}
							</h1>
							<p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
								{service.cluster_id && service.cluster_id !== "default" && (
									<span className="text-blue-600 dark:text-blue-400">
										{service.cluster_id} ·{" "}
									</span>
								)}
								{service.namespace && `${service.namespace} · `}
								{mode === "kubernetes"
									? getMessage().INSTRUMENTATION_HUB_SYSTEM_KUBERNETES
									: mode === "docker"
										? getMessage().INSTRUMENTATION_HUB_SYSTEM_DOCKER
										: getMessage().INSTRUMENTATION_HUB_SYSTEM_LINUX}{" "}
								· {getMessage().INSTRUMENTATION_HUB_LAST_SEEN_PREFIX}{formatBrowserDateTime(service.last_seen)}
							</p>
						</div>
					</div>
					<Badge
						variant={
							isPending ? "outline" : isInstrumented ? "default" : "secondary"
						}
						className={`text-sm ${isPending ? "inline-flex items-center gap-1.5" : ""}`}
					>
						{isPending && <Loader2 className="w-3 h-3 animate-spin" />}
						{isPending && pendingAction
							? pendingActionLabel(pendingAction)
							: isInstrumented
								? getMessage().INSTRUMENTATION_HUB_STATUS_INSTRUMENTED
								: getMessage().INSTRUMENTATION_HUB_STATUS_DISCOVERED}
					</Badge>
				</div>

				<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
					<Stat
						label={getMessage().INSTRUMENTATION_HUB_STAT_PROVIDERS}
						value={String(service.llm_providers?.length || 0)}
					/>
					<Stat label={getMessage().INSTRUMENTATION_HUB_STAT_PID} value={service.pid > 0 ? String(service.pid) : "-"} />
					<Stat
						label={getMessage().INSTRUMENTATION_HUB_STAT_RUNTIME}
						value={service.language_runtime || getMessage().INSTRUMENTATION_HUB_STAT_RUNTIME_UNKNOWN}
					/>
					<Stat
						label={getMessage().INSTRUMENTATION_HUB_STAT_FIRST_SEEN}
						value={formatBrowserDateTime(service.first_seen)}
					/>
				</div>

				{service.llm_providers && service.llm_providers.length > 0 && (
					<div className="mt-5">
						<div className="text-xs font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-2">
							{getMessage().INSTRUMENTATION_HUB_MODEL_PROVIDERS}
						</div>
						<div className="flex flex-wrap gap-2">
							{service.llm_providers.map((provider) => (
								<div
									key={provider}
									className="inline-flex items-center gap-2 rounded-md border dark:border-stone-800 px-3 py-2 text-sm text-stone-700 dark:text-stone-200"
								>
									<ProviderIcon
										provider={provider}
										className="w-4 h-4 shrink-0"
									/>
									<span className="capitalize">
										{formatProviderLabel(provider)}
									</span>
								</div>
							))}
						</div>
					</div>
				)}

				{service.resource_attributes &&
					Object.keys(service.resource_attributes).length > 0 && (
						<ResourceAttributesPanel attrs={service.resource_attributes} />
					)}
			</div>

			<div className="border dark:border-stone-800 rounded-lg p-4">
				<h3 className="text-sm font-medium text-stone-600 dark:text-stone-400 mb-4">
					{getMessage().INSTRUMENTATION_HUB_CONTROLS}
				</h3>
				<div className="flex flex-col gap-4">
					<div className="flex items-center justify-between p-4 bg-stone-50 dark:bg-stone-800/50 rounded-lg">
						<div>
							<div className="font-medium text-stone-900 dark:text-stone-100">
								{getMessage().INSTRUMENTATION_HUB_LLM_OBSERVABILITY_LABEL}
							</div>
							<div className="text-sm text-stone-500 dark:text-stone-400 mt-1">
								{getMessage().INSTRUMENTATION_HUB_LLM_OBSERVABILITY_DESCRIPTION}
							</div>
						</div>
						<button
							onClick={toggleInstrumentation}
							disabled={actionLoading || isPending}
							className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
								isPending
									? "border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-500 dark:text-stone-300"
									:
								isInstrumented
									? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
									: "bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
							}`}
						>
							{(actionLoading || isPending) && (
								<Loader2 className="w-3 h-3 animate-spin" />
							)}
							{isPending && pendingAction
								? getMessage().INSTRUMENTATION_HUB_WORKING_SUFFIX(pendingActionLabel(pendingAction))
								: actionLoading
									? getMessage().INSTRUMENTATION_HUB_ACTION_WORKING_ELLIPSIS
									: isInstrumented
										? getMessage().INSTRUMENTATION_HUB_SERVICE_ACTION_DISABLE
										: getMessage().INSTRUMENTATION_HUB_SERVICE_ACTION_ENABLE}
						</button>
					</div>

					{isPython && (
						<div className="flex items-center justify-between p-4 bg-stone-50 dark:bg-stone-800/50 rounded-lg">
							<div>
								<div className="font-medium text-stone-900 dark:text-stone-100">
									{getMessage().INSTRUMENTATION_HUB_AGENT_OBSERVABILITY_LABEL}
								</div>
								<div className="text-sm text-stone-500 dark:text-stone-400 mt-1">
									{getMessage().INSTRUMENTATION_HUB_AGENT_OBSERVABILITY_DESCRIPTION}
									{" "}{agentActionLabel}
								</div>
								<div className="text-xs text-stone-400 mt-1">
									{getMessage().INSTRUMENTATION_HUB_CURRENTLY_PREFIX}
									{!agentObservabilityFetched
										? getMessage().INSTRUMENTATION_HUB_CHECKING_STATUS
										: agentTransitioning
											? agentLocalIntent === "enabling" || agentObservability?.desired_status === "enabled"
												? getMessage().INSTRUMENTATION_HUB_DEPLOYING_IN_PROGRESS
												: getMessage().INSTRUMENTATION_HUB_REMOVING_IN_PROGRESS
											: agentObservabilityEnabled
												? getMessage().INSTRUMENTATION_HUB_ENABLED
												: getMessage().INSTRUMENTATION_HUB_DISABLED}
									.{" "}
									{!agentTransitioning && agentReasonText}
									{getMessage().INSTRUMENTATION_HUB_AGENT_USE_NOTE}
								</div>
								{agentObservabilityEnabled &&
									service?.resource_attributes?.[
										"openlit.sdk.version"
									] && (
										<div className="mt-1.5 text-xs text-stone-400">
											{getMessage().INSTRUMENTATION_HUB_SDK_VERSION_LABEL}{" "}
											<span className="font-mono text-stone-500 dark:text-stone-300">
												{
													service.resource_attributes[
														"openlit.sdk.version"
													]
												}
											</span>
										</div>
									)}
								{agentObservability?.is_manual && agentObservability?.reason && (
									<div className="mt-2 text-xs bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded px-2.5 py-2">
										<div className="font-medium text-blue-700 dark:text-blue-400 mb-1">
											{getMessage().INSTRUMENTATION_HUB_MANUAL_SETUP_REQUIRED}
										</div>
										<pre className="whitespace-pre-wrap text-blue-600 dark:text-blue-300 font-mono text-[11px] leading-relaxed">
											{agentObservability.reason}
										</pre>
									</div>
								)}
								{agentObservability?.is_containerized && agentObservability?.status === "unsupported" && (
									<div className="mt-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2.5 py-1.5">
										{getMessage().INSTRUMENTATION_HUB_CONTAINERIZED_WARNING}
									</div>
								)}
								{agentObservability?.is_naked_pod && (
									<div className="mt-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2.5 py-1.5">
										{getMessage().INSTRUMENTATION_HUB_NAKED_POD_WARNING}
									</div>
								)}
							</div>
							<button
								onClick={toggleAgentObservability}
								disabled={
									actionLoading ||
									agentTransitioning ||
									agentObservability?.automatable === false ||
									agentObservability?.conflict === "existing_otel"
								}
								className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
									agentTransitioning
										? "border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400"
										: agentObservabilityEnabled
											? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
											: "bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
								}`}
							>
								{(agentTransitioning || actionLoading) && (
									<Loader2 className="w-3 h-3 animate-spin" />
								)}
								{agentToggleLabel()}
							</button>
						</div>
					)}
				</div>
			</div>

			{service?.last_error && (
				<div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
					<div className="flex items-start gap-3">
						<div className="text-red-600 dark:text-red-400 mt-0.5 text-sm font-medium shrink-0">
							{getMessage().INSTRUMENTATION_HUB_ACTION_FAILED}
						</div>
						<div className="text-sm text-red-700 dark:text-red-300 min-w-0">
							<span className="font-medium">
								{service.last_error_action === "instrument"
									? getMessage().INSTRUMENTATION_HUB_LAST_ERROR_INSTRUMENT
									: service.last_error_action === "uninstrument"
										? getMessage().INSTRUMENTATION_HUB_LAST_ERROR_UNINSTRUMENT
										: service.last_error_action === "enable_python_sdk"
											? getMessage().INSTRUMENTATION_HUB_LAST_ERROR_ENABLE_AGENT
											: service.last_error_action === "disable_python_sdk"
												? getMessage().INSTRUMENTATION_HUB_LAST_ERROR_DISABLE_AGENT
												: getMessage().INSTRUMENTATION_HUB_LAST_ERROR_ACTION}
							</span>
							{": "}
							{service.last_error}
						</div>
					</div>
				</div>
			)}

			<div className="border dark:border-stone-800 rounded-lg p-4">
				<h3 className="text-sm font-medium text-stone-600 dark:text-stone-400 mb-3">
					{getMessage().INSTRUMENTATION_HUB_SERVICE_INFO}
				</h3>
				<div className="grid grid-cols-2 gap-3 text-sm">
					<div>
						<span className="text-stone-400">{getMessage().INSTRUMENTATION_HUB_STAT_FIRST_SEEN}</span>
						<div className="text-stone-900 dark:text-stone-100">
							{formatBrowserDateTime(service.first_seen)}
						</div>
					</div>
					<div>
						<span className="text-stone-400">{getMessage().INSTRUMENTATION_HUB_COLUMN_LAST_SEEN}</span>
						<div className="text-stone-900 dark:text-stone-100">
							{formatBrowserDateTime(service.last_seen)}
						</div>
					</div>
					{service.open_ports && service.open_ports.length > 0 && (
						<div>
							<span className="text-stone-400">{getMessage().INSTRUMENTATION_HUB_OPEN_PORTS}</span>
							<div className="text-stone-900 dark:text-stone-100">
								{service.open_ports.join(", ")}
							</div>
						</div>
					)}
					{service.pid > 0 && (
						<div>
							<span className="text-stone-400">{getMessage().INSTRUMENTATION_HUB_STAT_PID}</span>
							<div className="text-stone-900 dark:text-stone-100">
								{service.pid}
							</div>
						</div>
					)}
					{service.exe_path && (
						<div className="col-span-2">
							<span className="text-stone-400">{getMessage().INSTRUMENTATION_HUB_EXECUTABLE}</span>
							<div className="text-stone-900 dark:text-stone-100 font-mono text-xs">
								{service.exe_path}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="border dark:border-stone-800 rounded-lg p-3">
			<div className="text-sm font-semibold text-stone-900 dark:text-stone-100 break-all">
				{value}
			</div>
			<div className="text-xs text-stone-500 dark:text-stone-400">
				{label}
			</div>
		</div>
	);
}

function ResourceAttributesPanel({
	attrs,
}: {
	attrs: Record<string, string>;
}) {
	const entries = Object.entries(attrs).sort(([a], [b]) =>
		a.localeCompare(b)
	);
	return (
		<div className="mt-5 border dark:border-stone-800 rounded-lg overflow-hidden">
			<div className="px-4 py-2.5 bg-stone-50 dark:bg-stone-800 border-b border-stone-200 dark:border-stone-700">
				<span className="text-xs font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">
					{getMessage().INSTRUMENTATION_HUB_RESOURCE_ATTRIBUTES}
				</span>
			</div>
			<div className="max-h-72 overflow-y-auto px-4 py-3">
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
					{entries.map(([key, value]) => (
						<div key={key} className="flex flex-col min-w-0">
							<span className="text-[11px] text-stone-400 dark:text-stone-500 font-mono break-all">
								{key}
							</span>
							<span className="text-sm text-stone-700 dark:text-stone-300 break-all">
								{value}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
