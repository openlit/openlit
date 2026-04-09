"use client";

import { useEffect, useCallback } from "react";
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
	} = useFetchWrapper<{ enabled: boolean }>();
	const { fireRequest: doAction, isLoading: actionLoading } =
		useFetchWrapper();

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
			title: service?.service_name || "Service Detail",
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

	const isInstrumented = service?.instrumentation_status === "instrumented";
	const instance = instances?.find(
		(candidate) => candidate.instance_id === service?.controller_instance_id
	);
	const mode = instance?.mode || "linux";
	const isK8s = mode === "kubernetes";
	const agentObservabilityEnabled = !!agentObservability?.enabled;

	useEffect(() => {
		if (!service || !isK8s) return;
		fetchAgentObservability({
			requestType: "GET",
			url: `/api/controller/catalog/${id}/agent-instrument`,
		});
	}, [service, isK8s, id, fetchAgentObservability]);

	const toggleInstrumentation = async () => {
		const action = isInstrumented ? "uninstrument" : "instrument";
		await doAction({
			requestType: "POST",
			url: `/api/controller/catalog/${id}/${action}`,
			successCb: () => {
				toast.success(
					`Queued ${action}`
				);
				refresh();
			},
			failureCb: (err: any) => {
				toast.error(`Failed: ${err}`);
			},
		});
	};

	const toggleAgentObservability = async () => {
		const requestType = agentObservabilityEnabled ? "DELETE" : "POST";
		await doAction({
			requestType,
			url: `/api/controller/catalog/${id}/agent-instrument`,
			successCb: () => {
				toast.success(
					agentObservabilityEnabled
						? "Agent observability disabled"
						: "Agent observability will be enabled on next pod restart"
				);
				fetchAgentObservability({
					requestType: "GET",
					url: `/api/controller/catalog/${id}/agent-instrument`,
				});
			},
			failureCb: (err: any) => {
				toast.error(`Failed: ${err}`);
			},
		});
	};

	const formatProviderLabel = (provider: string) =>
		provider.replaceAll("_", " ");

	if (isLoading || !service) {
		return (
			<div className="flex items-center justify-center w-full py-16">
				<div className="text-stone-400">Loading service details...</div>
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
				Back to Hub
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
								{service.namespace && `${service.namespace} · `}
								{mode === "kubernetes"
									? "Kubernetes"
									: mode === "docker"
										? "Docker"
										: "Linux"}{" "}
								· Last seen {formatBrowserDateTime(service.last_seen)}
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
							? pendingAction === "instrument"
								? "Instrumenting"
								: "Uninstrumenting"
							: isInstrumented
								? "Instrumented"
								: "Discovered"}
					</Badge>
				</div>

				<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
					<Stat
						label="Providers"
						value={String(service.llm_providers?.length || 0)}
					/>
					<Stat label="PID" value={service.pid > 0 ? String(service.pid) : "-"} />
					<Stat
						label="Runtime"
						value={service.language_runtime || "Unknown"}
					/>
					<Stat
						label="First Seen"
						value={formatBrowserDateTime(service.first_seen)}
					/>
				</div>

				{service.llm_providers && service.llm_providers.length > 0 && (
					<div className="mt-5">
						<div className="text-xs font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-2">
							Model Providers
						</div>
						<div className="flex flex-wrap gap-2">
							{service.llm_providers.map((provider) => (
								<div
									key={provider}
									className="inline-flex items-center gap-2 rounded-md border dark:border-stone-700 px-3 py-2 text-sm text-stone-700 dark:text-stone-200"
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

			<div className="border dark:border-stone-700 rounded-lg p-4">
				<h3 className="text-sm font-medium text-stone-600 dark:text-stone-400 mb-4">
					Controls
				</h3>
				<div className="flex flex-col gap-4">
					<div className="flex items-center justify-between p-4 bg-stone-50 dark:bg-stone-800/50 rounded-lg">
						<div>
							<div className="font-medium text-stone-900 dark:text-stone-100">
								LLM Observability
							</div>
							<div className="text-sm text-stone-500 dark:text-stone-400 mt-1">
								Enable eBPF-based LLM observability for RED metrics,
								model name, tokens, and tool calls.
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
								? pendingAction === "instrument"
									? "Instrumenting..."
									: "Uninstrumenting..."
								: actionLoading
									? "Working..."
									: isInstrumented
										? "Disable"
										: "Enable"}
						</button>
					</div>

					{isK8s && (
						<div className="flex items-center justify-between p-4 bg-stone-50 dark:bg-stone-800/50 rounded-lg">
							<div>
								<div className="font-medium text-stone-900 dark:text-stone-100">
									Agent Observability
								</div>
								<div className="text-sm text-stone-500 dark:text-stone-400 mt-1">
									Injects the OpenLIT agent SDK for LangChain,
									LangGraph, CrewAI, and similar agent frameworks.
									Requires a pod restart.
								</div>
								<div className="text-xs text-stone-400 mt-1">
									Currently{" "}
									{!agentObservabilityFetched
										? "checking status"
										: agentObservabilityEnabled
											? "enabled"
											: "disabled"}
									.{" "}
									Use this only for agent framework spans.
									Provider-level LLM traffic still comes from eBPF.
								</div>
							</div>
							<button
								onClick={toggleAgentObservability}
								disabled={actionLoading}
								className="px-4 py-2 text-sm font-medium border dark:border-stone-600 rounded-lg text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
							>
								{!agentObservabilityFetched
									? "Checking..."
									: agentObservabilityEnabled
										? "Disable"
										: "Enable"}
							</button>
						</div>
					)}
				</div>
			</div>

			<div className="border dark:border-stone-700 rounded-lg p-4">
				<h3 className="text-sm font-medium text-stone-600 dark:text-stone-400 mb-3">
					Service Info
				</h3>
				<div className="grid grid-cols-2 gap-3 text-sm">
					<div>
						<span className="text-stone-400">First Seen</span>
						<div className="text-stone-900 dark:text-stone-100">
							{formatBrowserDateTime(service.first_seen)}
						</div>
					</div>
					<div>
						<span className="text-stone-400">Last Seen</span>
						<div className="text-stone-900 dark:text-stone-100">
							{formatBrowserDateTime(service.last_seen)}
						</div>
					</div>
					{service.open_ports && service.open_ports.length > 0 && (
						<div>
							<span className="text-stone-400">Open Ports</span>
							<div className="text-stone-900 dark:text-stone-100">
								{service.open_ports.join(", ")}
							</div>
						</div>
					)}
					{service.pid > 0 && (
						<div>
							<span className="text-stone-400">PID</span>
							<div className="text-stone-900 dark:text-stone-100">
								{service.pid}
							</div>
						</div>
					)}
					{service.exe_path && (
						<div className="col-span-2">
							<span className="text-stone-400">Executable</span>
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
		<div className="border dark:border-stone-700 rounded-lg p-3">
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
		<div className="mt-5 border dark:border-stone-700 rounded-lg overflow-hidden">
			<div className="px-4 py-2.5 bg-stone-50 dark:bg-stone-800 border-b dark:border-stone-700">
				<span className="text-xs font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">
					Resource Attributes
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
