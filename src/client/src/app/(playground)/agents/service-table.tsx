"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type {
	ControllerService,
	ControllerInstance,
} from "@/types/controller";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { formatBrowserDateTime } from "@/utils/date";
import { toast } from "sonner";
import LinuxSvg from "@/components/svg/linux";
import KubernetesSvg from "@/components/svg/kubernetes";
import DockerSvg from "@/components/svg/docker";
import { ProviderIcon } from "@/components/svg/providers";
import getMessage from "@/constants/messages";

interface ServiceTableProps {
	services: ControllerService[];
	instances: ControllerInstance[];
	onRefresh: () => void;
	isFetched: boolean;
	isLoading: boolean;
	statusFilter: string[];
	systemFilter: string[];
	providerFilter: string[];
}

interface EnrichedService extends ControllerService {
	mode: "linux" | "docker" | "kubernetes" | "standalone";
	agentStatus: "enabled" | "disabled" | "unsupported" | "manual";
	agentSource: string;
	agentTransitioning: boolean;
	agentTransitionDirection: "enabling" | "disabling" | null;
}

type ServiceColumnKey =
	| "service"
	| "system"
	| "providers"
	| "aiObservability"
	| "agentObservability"
	| "lastSeen";

function AIObservabilityCell({
	service,
	onRefresh,
}: {
	service: EnrichedService;
	onRefresh: () => void;
}) {
	const { fireRequest, isLoading } = useFetchWrapper();
	const isInstrumented =
		service.instrumentation_status === "instrumented" ||
		service.desired_instrumentation_status === "instrumented";
	const pendingAction = service.pending_action || undefined;
	const isPending =
		(service.pending_action_status === "pending" ||
			service.pending_action_status === "acknowledged") &&
		(pendingAction === "instrument" || pendingAction === "uninstrument");

	const handleAction = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (isPending) return;
		const action = isInstrumented ? "uninstrument" : "instrument";
		await fireRequest({
			requestType: "POST",
			url: `/api/controller/catalog/${service.id}/${action}`,
			successCb: () => {
				toast.success(
					getMessage().AGENTS_SERVICE_QUEUED_ACTION(action, service.service_name)
				);
				onRefresh();
			},
			failureCb: (err: any) => {
				toast.error(getMessage().AGENTS_SERVICE_FAILED(err));
			},
		});
	};

	if (isPending) {
		return (
			<button
				disabled
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-300 bg-stone-50 dark:bg-stone-800 opacity-80"
			>
				<Loader2 className="w-3 h-3 animate-spin" />
				{pendingAction === "uninstrument" ? getMessage().AGENTS_SERVICE_ACTION_DISABLING : getMessage().AGENTS_SERVICE_ACTION_ENABLING}
			</button>
		);
	}

	return (
		<button
			onClick={handleAction}
			disabled={isLoading}
			className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ${
				isInstrumented
					? "border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
					: "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-stone-200"
			}`}
		>
			{isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
			{isLoading ? getMessage().AGENTS_SERVICE_ACTION_WORKING : isInstrumented ? getMessage().AGENTS_SERVICE_ACTION_DISABLE : getMessage().AGENTS_SERVICE_ACTION_ENABLE}
		</button>
	);
}

function AgentObservabilityCell({
	service,
	onRefresh,
}: {
	service: EnrichedService;
	onRefresh: () => void;
}) {
	const { fireRequest, isLoading } = useFetchWrapper();
	const { agentStatus, agentTransitioning, agentTransitionDirection } = service;
	const pendingAction = service.pending_action || undefined;
	const isPending =
		(service.pending_action_status === "pending" ||
			service.pending_action_status === "acknowledged") &&
		(pendingAction === "enable_python_sdk" ||
			pendingAction === "disable_python_sdk");
	const showTransitioning = isPending || agentTransitioning;

	if (agentStatus === "unsupported") {
		return (
			<span className="text-xs text-stone-400 dark:text-stone-500">—</span>
		);
	}

	const handleAction = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (showTransitioning) return;
		const enabling = agentStatus !== "enabled" && agentStatus !== "manual";
		await fireRequest({
			requestType: enabling ? "POST" : "DELETE",
			url: `/api/controller/catalog/${service.id}/agent-instrument`,
			successCb: () => {
				toast.success(
					enabling
						? getMessage().AGENTS_AGENT_ENABLING_FOR(service.service_name)
						: getMessage().AGENTS_AGENT_DISABLING_FOR(service.service_name)
				);
				onRefresh();
			},
			failureCb: (err: any) => {
				toast.error(getMessage().AGENTS_SERVICE_FAILED(err));
			},
		});
	};

	if (showTransitioning) {
		const transitionLabel = isPending
			? pendingAction === "enable_python_sdk"
				? getMessage().AGENTS_SERVICE_ACTION_ENABLING
				: getMessage().AGENTS_SERVICE_ACTION_DISABLING
			: agentTransitionDirection === "enabling"
				? getMessage().AGENTS_SERVICE_ACTION_ENABLING
				: getMessage().AGENTS_SERVICE_ACTION_DISABLING;
		return (
			<button
				disabled
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-300 bg-stone-50 dark:bg-stone-800 opacity-80"
			>
				<Loader2 className="w-3 h-3 animate-spin" />
				{transitionLabel}
			</button>
		);
	}

	if (agentStatus === "manual") {
		return (
			<div className="flex items-center gap-2">
				<span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
					{getMessage().AGENTS_SERVICE_MANUAL_BADGE}
				</span>
				<button
					onClick={handleAction}
					disabled={isLoading}
					className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
				>
					{isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
					{isLoading ? getMessage().AGENTS_SERVICE_ACTION_ELLIPSIS : getMessage().AGENTS_SERVICE_ACTION_DISABLE}
				</button>
			</div>
		);
	}

	return (
		<button
			onClick={handleAction}
			disabled={isLoading}
			className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ${
				agentStatus === "enabled"
					? "border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
					: "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-stone-200"
			}`}
		>
			{isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
			{isLoading
				? getMessage().AGENTS_SERVICE_ACTION_WORKING
				: agentStatus === "enabled"
					? getMessage().AGENTS_SERVICE_ACTION_DISABLE
					: getMessage().AGENTS_SERVICE_ACTION_ENABLE}
		</button>
	);
}

const columns: Columns<ServiceColumnKey, EnrichedService> = {
	service: {
		header: () => getMessage().AGENTS_COLUMN_SERVICE,
		cell: ({ row }) => (
			<div className="flex items-center gap-2 overflow-hidden">
				<Link
					href={`/agents/${row.id}`}
					className="font-medium text-stone-900 dark:text-stone-100 hover:underline truncate"
					onClick={(e) => e.stopPropagation()}
				>
					{row.service_name}
				</Link>
				{row.cluster_id && row.cluster_id !== "default" && (
					<span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800 flex-shrink-0">
						{row.cluster_id}
					</span>
				)}
				{row.mode !== "kubernetes" && row.pid > 0 && (
					<span className="text-xs text-stone-400 flex-shrink-0">
						{getMessage().AGENTS_SERVICE_PID_PREFIX} {row.pid}
					</span>
				)}
			</div>
		),
		enableHiding: false,
	},
	system: {
		header: () => getMessage().AGENTS_COLUMN_SYSTEM,
		cell: ({ row }) => {
			const title =
				row.mode === "kubernetes"
					? getMessage().AGENTS_SYSTEM_KUBERNETES
					: row.mode === "docker"
						? getMessage().AGENTS_SYSTEM_DOCKER
						: getMessage().AGENTS_SYSTEM_LINUX;
			return (
				<div
					className="flex items-center text-stone-600 dark:text-stone-400"
					title={title}
				>
					{row.mode === "kubernetes" ? (
						<KubernetesSvg className="w-5 h-5" />
					) : row.mode === "docker" ? (
						<DockerSvg className="w-5 h-5" />
					) : (
						<LinuxSvg className="w-5 h-5" />
					)}
				</div>
			);
		},
	},
	providers: {
		header: () => getMessage().AGENTS_COLUMN_PROVIDERS,
		cell: ({ row }) => (
			<div className="flex items-center gap-2">
				{row.llm_providers && row.llm_providers.length > 0 ? (
					row.llm_providers.map((p) => (
						<span key={p} title={p}>
							<ProviderIcon
								provider={p}
								className="w-5 h-5"
							/>
						</span>
					))
				) : (
					<span className="text-stone-400">—</span>
				)}
			</div>
		),
	},
	lastSeen: {
		header: () => getMessage().AGENTS_COLUMN_LAST_SEEN,
		cell: ({ row }) => (
			<span className="text-xs truncate">
				{formatBrowserDateTime(row.last_seen)}
			</span>
		),
	},
	aiObservability: {
		header: () => getMessage().AGENTS_COLUMN_LLM_OBSERVABILITY,
		cell: ({ row, extraFunctions }) => (
			<AIObservabilityCell
				service={row}
				onRefresh={extraFunctions.onRefresh}
			/>
		),
	},
	agentObservability: {
		header: () => getMessage().AGENTS_COLUMN_AGENT_OBSERVABILITY,
		cell: ({ row, extraFunctions }) => (
			<AgentObservabilityCell
				service={row}
				onRefresh={extraFunctions.onRefresh}
			/>
		),
	},
};

const VISIBILITY_COLUMNS: Record<ServiceColumnKey, boolean> = {
	service: true,
	system: true,
	providers: true,
	lastSeen: true,
	aiObservability: true,
	agentObservability: true,
};

export default function ServiceTable({
	services,
	instances,
	onRefresh,
	isFetched,
	isLoading,
	statusFilter,
	systemFilter,
	providerFilter,
}: ServiceTableProps) {
	const router = useRouter();
	const instanceMap = useMemo(() => {
		const map = new Map<string, ControllerInstance>();
		for (const inst of instances) {
			map.set(inst.instance_id, inst);
		}
		return map;
	}, [instances]);

	const enriched: EnrichedService[] = useMemo(() => {
		return services.map((svc) => {
			const inst = instanceMap.get(svc.controller_instance_id);
			const attrs = svc.resource_attributes || {};
		const isPython =
			(attrs["process.runtime.name"] || "").toLowerCase() === "python";
			const agentStatusRaw =
				attrs["openlit.agent_observability.status"] || "";
			const agentSource =
				attrs["openlit.agent_observability.source"] || "";

		let agentStatus: "enabled" | "disabled" | "unsupported" | "manual" =
			"disabled";
			if (!isPython) {
				agentStatus = "unsupported";
			} else if (
				agentStatusRaw === "enabled" ||
				svc.desired_agent_status === "enabled"
			) {
				agentStatus = "enabled";
			} else if (agentStatusRaw === "manual") {
				agentStatus = "manual";
			}

			const actualNormalized = agentStatusRaw === "enabled" ? "enabled" : "disabled";
			const desiredNormalized = svc.desired_agent_status === "enabled" ? "enabled" : "disabled";
			const agentTransitioning = isPython && actualNormalized !== desiredNormalized;
			let agentTransitionDirection: "enabling" | "disabling" | null = null;
			if (agentTransitioning) {
				agentTransitionDirection = desiredNormalized === "enabled" ? "enabling" : "disabling";
			}

			return {
				...svc,
				mode: inst?.mode || "linux",
				agentStatus,
				agentSource,
				agentTransitioning,
				agentTransitionDirection,
			};
		});
	}, [services, instanceMap]);

	const filtered = useMemo(() => {
		return enriched.filter((svc) => {
			if (
				statusFilter.length > 0 &&
				!statusFilter.includes(svc.instrumentation_status)
			)
				return false;
			if (
				providerFilter.length > 0 &&
				!(svc.llm_providers || []).some((p) => providerFilter.includes(p))
			)
				return false;
			if (systemFilter.length > 0) {
				const sysMatch = systemFilter.some((sf) => {
					if (sf === "kubernetes") return svc.mode === "kubernetes";
					if (sf === "docker")
						return svc.mode === "docker" || svc.mode === "standalone";
					if (sf === "linux") return svc.mode === "linux";
					return false;
				});
				if (!sysMatch) return false;
			}
			return true;
		});
	}, [enriched, statusFilter, providerFilter, systemFilter]);

	return (
		<DataTable
			columns={columns}
			data={filtered}
			isFetched={isFetched}
			isLoading={isLoading}
			visibilityColumns={VISIBILITY_COLUMNS}
			extraFunctions={{ onRefresh }}
			onClick={(row) => router.push(`/agents/${row.id}`)}
		/>
	);
}
