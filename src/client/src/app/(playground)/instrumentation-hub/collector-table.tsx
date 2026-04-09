"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type {
	CollectorInstance,
	CollectorHealth,
} from "@/types/collector";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import LinuxSvg from "@/components/svg/linux";
import KubernetesSvg from "@/components/svg/kubernetes";
import DockerSvg from "@/components/svg/docker";

interface CollectorTableProps {
	instances: CollectorInstance[];
	isFetched: boolean;
	isLoading: boolean;
}

const HEALTH_STYLES: Record<CollectorHealth, string> = {
	healthy: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	degraded:
		"bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
	error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

type CollectorColumnKey =
	| "collector"
	| "mode"
	| "status"
	| "services"
	| "lastHeartbeat";

const columns: Columns<CollectorColumnKey, CollectorInstance> = {
	collector: {
		header: () => "Collector",
		cell: ({ row }) => (
			<div className="overflow-hidden">
				<div className="font-medium text-stone-900 dark:text-stone-100 truncate">
					{row.node_name || row.instance_id}
				</div>
				{row.version && (
					<div className="text-xs text-stone-400 mt-0.5">
						v{row.version}
					</div>
				)}
			</div>
		),
		enableHiding: false,
	},
	mode: {
		header: () => "Mode",
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
	status: {
		header: () => "Status",
		cell: ({ row }) => (
			<Badge
				variant="outline"
				className={HEALTH_STYLES[row.status] || ""}
			>
				{row.status}
			</Badge>
		),
	},
	services: {
		header: () => "Services",
		cell: ({ row }) => (
			<span className="text-xs">
				{row.services_discovered} discovered
				{row.services_instrumented > 0 && (
					<>
						{" / "}
						{row.services_instrumented} instrumented
					</>
				)}
			</span>
		),
	},
	lastHeartbeat: {
		header: () => "Last Heartbeat",
		cell: ({ row }) => (
			<span className="text-xs truncate">
				{new Date(row.last_heartbeat).toLocaleString()}
			</span>
		),
	},
};

const VISIBILITY_COLUMNS: Record<CollectorColumnKey, boolean> = {
	collector: true,
	mode: true,
	status: true,
	services: true,
	lastHeartbeat: true,
};

export default function CollectorTable({
	instances,
	isFetched,
	isLoading,
}: CollectorTableProps) {
	const router = useRouter();

	const handleClick = (row: CollectorInstance) => {
		router.push(`/instrumentation-hub/collector/${row.instance_id}`);
	};

	return (
		<div className="flex flex-col gap-3 grow">
			<DataTable
				columns={columns}
				data={instances}
				isFetched={isFetched}
				isLoading={isLoading}
				visibilityColumns={VISIBILITY_COLUMNS}
				onClick={handleClick}
			/>
		</div>
	);
}
