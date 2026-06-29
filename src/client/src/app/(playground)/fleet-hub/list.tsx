"use client";
import DataTable from "@/components/data-table/table";
import { Agent } from "@/types/fleet-hub";

import { Badge } from "@/components/ui/badge";
import { Columns } from "@/components/data-table/columns";
import { useRouter } from "next/navigation";
import { useRootStore } from "@/store";
import { getVisibilityColumnsOfPage } from "@/selectors/page";
import VisibilityColumns from "@/components/(playground)/filter/visibility-columns";
import { getAttributeValue } from "@/helpers/client/fleet-hub";
import LinuxSvg from "@/components/svg/linux";
import WindowsSvg from "@/components/svg/windows";
import { formatDate } from "@/utils/date";
import MacSvg from "@/components/svg/mac";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import OpenTelemetrySvg from "@/components/svg/opentelemetry";
import getMessage from "@/constants/messages";

const osTypeMap = {
	linux: <LinuxSvg />,
	windows: <WindowsSvg />,
	mac: <MacSvg />,
} as const;

const columns: Columns<string, Agent> = {
	id: {
		header: () => "ID",
		cell: ({ row }) => {
			return (<div
				className="block items-center overflow-hidden text-ellipsis whitespace-nowrap"
				title={row.InstanceIdStr}
			>
				{row.InstanceIdStr}
			</div>)
		},
	},
	name: {
		header: () => "Name",
		cell: ({ row }) => {
			const serviceName = getAttributeValue(row, "Status.agent_description.identifying_attributes", "service.name")
			return (<div
				className="block items-center overflow-hidden text-ellipsis whitespace-nowrap"
				title={serviceName}
			>
				{serviceName}
			</div>)
		},
		enableHiding: false,
	},
	version: {
		header: () => "Version",
		cell: ({ row }) => {
			const serviceVersion = getAttributeValue(
				row,
				"Status.agent_description.identifying_attributes",
				"service.version",
			)
			return (
				<div className="flex space-x-2 items-center" title={serviceVersion}>
					<span className="truncate font-medium">{serviceVersion}</span>
				</div>
			);
		},
		enableHiding: true,
	},
	os: {
		header: () => "Operating System",
		cell: ({ row }) => {
			const osType = getAttributeValue(
				row,
				"Status.agent_description.non_identifying_attributes",
				"os.type",
			)
			return (
				<div className="flex space-x-2 items-center" title={osType}>
					<span className="truncate font-medium">{osType in osTypeMap ? osTypeMap[osType as keyof typeof osTypeMap] : osType}</span>
				</div>
			);
		},
		enableHiding: true,
	},
	startedAt: {
		header: () => "Started At",
		cell: ({ row }) => {
			return (
				<div
					className="block items-center overflow-hidden text-ellipsis whitespace-nowrap"
					title={row.StartedAt}
				>
					{formatDate(row.StartedAt, { time: true })}
				</div>
			);
		},
		enableHiding: true,
	},
	status: {
		header: () => "Status",
		cell: ({ row }) => {
			return (
				<Badge variant={row.Status.health.healthy ? "default" : "destructive"} className={`${row.Status.health.healthy ? "bg-green-500 text-white" : "bg-red-500 text-white"}`}>
					{row.Status.health.status || "StatusError"}
				</Badge>
			);
		},
		enableHiding: false,
	},
	hostArchitecture: {
		header: () => "Host Architecture",
		cell: ({ row }) => {
			const hostArchitecture = getAttributeValue(
				row,
				"Status.agent_description.non_identifying_attributes",
				"host.arch",
			)
			return (
				<div className="flex space-x-2 items-center" title={hostArchitecture}>
					<span className="truncate font-medium">{hostArchitecture}</span>
				</div>
			);
		},
		enableHiding: true,
	}
};


export default function List({ agents, isLoading, isFetched }: {
	agents: Agent[];
	isLoading: boolean;
	isFetched: boolean;
}) {
	const visibilityColumns = useRootStore((state) =>
		getVisibilityColumnsOfPage(state, "fleethub")
	);
	const router = useRouter()

	const handleClick = (row: Agent) => {
		router.push(`/fleet-hub/${row.InstanceIdStr}`)
	}

	return (
		<div className="flex flex-col w-full h-full gap-3">
			<FeaturePageHeader eyebrow="Monitoring" title={getMessage().FEATURE_FLEET_HUB} description="Operate every collector from one control plane—health, configuration, and ownership stay visible as your telemetry footprint grows." icon={<OpenTelemetrySvg className="h-4 w-4" />} tone="border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300" actions={<VisibilityColumns columns={columns} pageName={"fleethub"} />} />
			<DataTable
				columns={columns}
				data={agents}
				isFetched={isFetched}
				isLoading={isLoading}
				visibilityColumns={visibilityColumns}
				onClick={handleClick}
			/>
		</div>
	);
}
