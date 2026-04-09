"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type {
	CollectorService,
	CollectorInstance,
} from "@/types/collector";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import LinuxSvg from "@/components/svg/linux";
import KubernetesSvg from "@/components/svg/kubernetes";
import DockerSvg from "@/components/svg/docker";
import { ProviderIcon } from "@/components/svg/providers";

interface ServiceTableProps {
	services: CollectorService[];
	instances: CollectorInstance[];
	onRefresh: () => void;
	isFetched: boolean;
	isLoading: boolean;
	statusFilter: string;
	systemFilter: string;
	providerFilter: string;
}

interface EnrichedService extends CollectorService {
	mode: "linux" | "docker" | "kubernetes" | "standalone";
}

type ServiceColumnKey =
	| "service"
	| "system"
	| "providers"
	| "status"
	| "lastSeen"
	| "action";

function ActionButton({
	service,
	onRefresh,
}: {
	service: EnrichedService;
	onRefresh: () => void;
}) {
	const { fireRequest, isLoading } = useFetchWrapper();
	const isInstrumented = service.instrumentation_status === "instrumented";

	const handleAction = async (e: React.MouseEvent) => {
		e.stopPropagation();
		const action = isInstrumented ? "uninstrument" : "instrument";
		await fireRequest({
			requestType: "POST",
			url: `/api/collector/catalog/${service.id}/${action}`,
			successCb: () => {
				toast.success(
					isInstrumented
						? `Removed instrumentation from ${service.service_name}`
						: `Queued instrumentation for ${service.service_name}`
				);
				onRefresh();
			},
			failureCb: (err: any) => {
				toast.error(`Failed: ${err}`);
			},
		});
	};

	return (
		<button
			onClick={handleAction}
			disabled={isLoading}
			className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ${
				isInstrumented
					? "border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
					: "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-stone-200"
			}`}
		>
			{isLoading
				? "..."
				: isInstrumented
					? "Uninstrument"
					: "Instrument"}
		</button>
	);
}

const columns: Columns<ServiceColumnKey, EnrichedService> = {
	service: {
		header: () => "Service",
		cell: ({ row }) => (
			<div className="flex items-center gap-2 overflow-hidden">
				<Link
					href={`/instrumentation-hub/${row.id}`}
					className="font-medium text-stone-900 dark:text-stone-100 hover:underline truncate"
					onClick={(e) => e.stopPropagation()}
				>
					{row.service_name}
				</Link>
				{row.mode !== "kubernetes" && row.pid > 0 && (
					<span className="text-xs text-stone-400 flex-shrink-0">
						PID {row.pid}
					</span>
				)}
			</div>
		),
		enableHiding: false,
	},
	system: {
		header: () => "System",
		cell: ({ row }) => {
			const title =
				row.mode === "kubernetes"
					? "Kubernetes"
					: row.mode === "docker"
						? "Docker"
						: "Linux";
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
		header: () => "Providers",
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
					<span className="text-stone-400">-</span>
				)}
			</div>
		),
	},
	status: {
		header: () => "Status",
		cell: ({ row }) => {
			const isInstrumented =
				row.instrumentation_status === "instrumented";
			return (
				<Badge variant={isInstrumented ? "default" : "secondary"}>
					{isInstrumented ? "Instrumented" : "Discovered"}
				</Badge>
			);
		},
	},
	lastSeen: {
		header: () => "Last Seen",
		cell: ({ row }) => (
			<span className="text-xs truncate">
				{new Date(row.last_seen).toLocaleString()}
			</span>
		),
	},
	action: {
		header: () => "Action",
		cell: ({ row, extraFunctions }) => (
			<ActionButton
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
	status: true,
	lastSeen: true,
	action: true,
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
	const instanceMap = useMemo(() => {
		const map = new Map<string, CollectorInstance>();
		for (const inst of instances) {
			map.set(inst.instance_id, inst);
		}
		return map;
	}, [instances]);

	const enriched: EnrichedService[] = useMemo(() => {
		return services.map((svc) => {
			const inst = instanceMap.get(svc.collector_instance_id);
			return {
				...svc,
				mode: inst?.mode || "linux",
			};
		});
	}, [services, instanceMap]);

	const filtered = useMemo(() => {
		return enriched.filter((svc) => {
			if (statusFilter && svc.instrumentation_status !== statusFilter)
				return false;
			if (
				providerFilter &&
				!(svc.llm_providers || []).includes(providerFilter)
			)
				return false;
			if (systemFilter) {
				if (systemFilter === "kubernetes" && svc.mode !== "kubernetes")
					return false;
				if (
					systemFilter === "docker" &&
					svc.mode !== "docker" &&
					svc.mode !== "standalone"
				)
					return false;
				if (systemFilter === "linux" && svc.mode !== "linux")
					return false;
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
		/>
	);
}
