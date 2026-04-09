"use client";

import { useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import type { CollectorService, CollectorInstance } from "@/types/collector";
import { toast } from "sonner";

export default function ServiceDetail() {
	const { id } = useParams<{ id: string }>();
	const router = useRouter();

	const {
		fireRequest: fetchService,
		data: service,
		isLoading,
	} = useFetchWrapper<CollectorService>();
	const {
		fireRequest: fetchInstances,
		data: instances,
	} = useFetchWrapper<CollectorInstance[]>();
	const { fireRequest: doAction, isLoading: actionLoading } =
		useFetchWrapper();

	const refresh = useCallback(() => {
		fetchService({
			requestType: "GET",
			url: `/api/collector/catalog/${id}`,
			responseDataKey: "data",
		});
		fetchInstances({
			requestType: "GET",
			url: "/api/collector/instances",
			responseDataKey: "data",
		});
	}, [id, fetchService, fetchInstances]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const isInstrumented = service?.instrumentation_status === "instrumented";
	const isK8s = instances?.some((i) => i.mode === "kubernetes");

	const toggleInstrumentation = async () => {
		const action = isInstrumented ? "uninstrument" : "instrument";
		await doAction({
			requestType: "POST",
			url: `/api/collector/catalog/${id}/${action}`,
			successCb: () => {
				toast.success(
					isInstrumented
						? "Instrumentation disabled"
						: "Instrumentation enabled"
				);
				refresh();
			},
			failureCb: (err: any) => {
				toast.error(`Failed: ${err}`);
			},
		});
	};

	const enableAgentSDK = async () => {
		await doAction({
			requestType: "POST",
			url: `/api/collector/catalog/${id}/agent-instrument`,
			successCb: () => {
				toast.success(
					"Agent SDK will be injected on next pod restart"
				);
			},
			failureCb: (err: any) => {
				toast.error(`Failed: ${err}`);
			},
		});
	};

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

			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
						{service.service_name}
					</h1>
					{service.namespace && (
						<span className="text-sm text-stone-500 dark:text-stone-400">
							{service.namespace}
						</span>
					)}
				</div>
				<Badge
					variant={isInstrumented ? "default" : "secondary"}
					className="text-sm"
				>
					{isInstrumented ? "Instrumented" : "Discovered"}
				</Badge>
			</div>

			{service.llm_providers && service.llm_providers.length > 0 && (
				<div className="border dark:border-stone-700 rounded-lg p-4">
					<h3 className="text-sm font-medium text-stone-600 dark:text-stone-400 mb-3">
						LLM Providers Detected
					</h3>
					<div className="flex flex-wrap gap-2">
						{service.llm_providers.map((p) => (
							<Badge key={p} variant="outline">
								{p}
							</Badge>
						))}
					</div>
				</div>
			)}

			<div className="border dark:border-stone-700 rounded-lg p-4">
				<h3 className="text-sm font-medium text-stone-600 dark:text-stone-400 mb-4">
					Controls
				</h3>
				<div className="flex flex-col gap-4">
					<div className="flex items-center justify-between p-4 bg-stone-50 dark:bg-stone-800/50 rounded-lg">
						<div>
							<div className="font-medium text-stone-900 dark:text-stone-100">
								eBPF Instrumentation
							</div>
							<div className="text-sm text-stone-500 dark:text-stone-400 mt-1">
								Captures RED metrics, model name, tokens, tool
								calls via eBPF
							</div>
						</div>
						<button
							onClick={toggleInstrumentation}
							disabled={actionLoading}
							className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
								isInstrumented
									? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
									: "bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
							}`}
						>
							{actionLoading
								? "..."
								: isInstrumented
									? "Disable"
									: "Enable"}
						</button>
					</div>

					{isK8s && (
						<div className="flex items-center justify-between p-4 bg-stone-50 dark:bg-stone-800/50 rounded-lg">
							<div>
								<div className="font-medium text-stone-900 dark:text-stone-100">
									Agent SDK Injection
								</div>
								<div className="text-sm text-stone-500 dark:text-stone-400 mt-1">
									For LangChain, LangGraph, CrewAI agent
									flows. Requires pod restart.
								</div>
								<div className="text-xs text-stone-400 mt-1">
									Only enables agent framework instrumentors
									(LLM provider data comes from eBPF)
								</div>
							</div>
							<button
								onClick={enableAgentSDK}
								disabled={actionLoading}
								className="px-4 py-2 text-sm font-medium border dark:border-stone-600 rounded-lg text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
							>
								Enable Agent SDK
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
							{new Date(service.first_seen).toLocaleString()}
						</div>
					</div>
					<div>
						<span className="text-stone-400">Last Seen</span>
						<div className="text-stone-900 dark:text-stone-100">
							{new Date(service.last_seen).toLocaleString()}
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
