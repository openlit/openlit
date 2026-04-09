"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type {
	ControllerInstance,
	ControllerHealth,
} from "@/types/controller";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import LinuxSvg from "@/components/svg/linux";
import KubernetesSvg from "@/components/svg/kubernetes";
import DockerSvg from "@/components/svg/docker";
import { formatBrowserDateTime } from "@/utils/date";

interface ControllerTableProps {
	instances: ControllerInstance[];
	isFetched: boolean;
	isLoading: boolean;
}

const HEALTH_STYLES: Record<ControllerHealth, string> = {
	healthy: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	degraded:
		"bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
	error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

type ControllerColumnKey =
	| "controller"
	| "mode"
	| "metadata"
	| "status"
	| "services"
	| "lastHeartbeat";

const columns: Columns<ControllerColumnKey, ControllerInstance> = {
	controller: {
		header: () => "Controller",
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
	metadata: {
		header: () => "Metadata",
		cell: ({ row }) => {
			const attrs = row.resource_attributes;
			if (!attrs || Object.keys(attrs).length === 0) return null;
			const node = attrs["k8s.node.name"] || attrs["host.name"];
			const ns = attrs["k8s.namespace.name"];
			const pod = attrs["k8s.pod.name"];
			return (
				<div className="text-xs space-y-0.5">
					{node && (
						<div className="text-stone-600 dark:text-stone-400">
							<span className="text-stone-400 dark:text-stone-500">node:</span>{" "}
							{node}
						</div>
					)}
					{ns && (
						<div className="text-stone-600 dark:text-stone-400">
							<span className="text-stone-400 dark:text-stone-500">ns:</span>{" "}
							{ns}
						</div>
					)}
					{pod && (
						<div className="text-stone-600 dark:text-stone-400 truncate max-w-[200px]">
							<span className="text-stone-400 dark:text-stone-500">pod:</span>{" "}
							{pod}
						</div>
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
				{formatBrowserDateTime(row.last_heartbeat)}
			</span>
		),
	},
};

const VISIBILITY_COLUMNS: Record<ControllerColumnKey, boolean> = {
	controller: true,
	mode: true,
	metadata: true,
	status: true,
	services: true,
	lastHeartbeat: true,
};

export default function ControllerTable({
	instances,
	isFetched,
	isLoading,
}: ControllerTableProps) {
	const router = useRouter();

	const handleClick = (row: ControllerInstance) => {
		router.push(`/instrumentation-hub/controller/${row.instance_id}`);
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
