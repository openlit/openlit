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
import getMessage from "@/constants/messages";

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
	| "system"
	| "metadata"
	| "services"
	| "lastSeen"
	| "status";

const columns: Columns<ControllerColumnKey, ControllerInstance> = {
	controller: {
		header: () => getMessage().AGENTS_COLUMN_CONTROLLER,
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
	metadata: {
		header: () => getMessage().AGENTS_COLUMN_METADATA,
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
							<span className="text-stone-400 dark:text-stone-500">{getMessage().AGENTS_METADATA_NODE_LABEL}</span>{" "}
							{node}
						</div>
					)}
					{ns && (
						<div className="text-stone-600 dark:text-stone-400">
							<span className="text-stone-400 dark:text-stone-500">{getMessage().AGENTS_METADATA_NS_LABEL}</span>{" "}
							{ns}
						</div>
					)}
					{pod && (
						<div className="text-stone-600 dark:text-stone-400 truncate max-w-[200px]">
							<span className="text-stone-400 dark:text-stone-500">{getMessage().AGENTS_METADATA_POD_LABEL}</span>{" "}
							{pod}
						</div>
					)}
				</div>
			);
		},
	},
	services: {
		header: () => getMessage().AGENTS_COLUMN_SERVICES,
		cell: ({ row }) => (
			<span className="text-xs">
				{getMessage().AGENTS_SERVICES_DISCOVERED_COUNT(row.services_discovered)}
				{row.services_instrumented > 0 && (
					<>
						{getMessage().AGENTS_SERVICES_INSTRUMENTED_COUNT(row.services_instrumented)}
					</>
				)}
			</span>
		),
	},
	lastSeen: {
		header: () => getMessage().AGENTS_COLUMN_LAST_SEEN,
		cell: ({ row }) => (
			<span className="text-xs truncate">
				{formatBrowserDateTime(row.last_heartbeat)}
			</span>
		),
	},
	status: {
		header: () => getMessage().AGENTS_COLUMN_STATUS,
		cell: ({ row }) => (
			<Badge
				variant="outline"
				className={HEALTH_STYLES[row.status] || ""}
			>
				{row.status}
			</Badge>
		),
	},
};

const VISIBILITY_COLUMNS: Record<ControllerColumnKey, boolean> = {
	controller: true,
	system: true,
	metadata: true,
	services: true,
	lastSeen: true,
	status: true,
};

export default function ControllerTable({
	instances,
	isFetched,
	isLoading,
}: ControllerTableProps) {
	const router = useRouter();

	const handleClick = (row: ControllerInstance) => {
		router.push(`/agents/controller/${row.instance_id}`);
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
