"use client";
import DataTable from "@/components/data-table/table";
import { Agent } from "@/types/opamp";

import { Badge } from "@/components/ui/badge";
import { Columns } from "@/components/data-table/columns";

const getAttributeValue = (attributes: any[], key: string) => {
	return attributes.find((attr) => attr.key === key)?.value.Value.StringValue || "N/A"
}

const columns: Columns<string, Agent> = {
	id: {
		header: () => "ID",
		cell: ({ row }) => {
			return (<div
				className="block items-center overflow-hidden text-ellipsis"
				title={row.InstanceIdStr}
			>
				{row.InstanceIdStr}
			</div>)
		},
	},
	name: {
		header: () => "Name",
		cell: ({ row }) => {
			const serviceName = getAttributeValue(row.Status.agent_description.identifying_attributes, "service.name")
			return (<div
				className="block items-center overflow-hidden text-ellipsis"
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
				row.Status.agent_description.identifying_attributes,
				"service.version",
			)
			return (
				<div className="flex space-x-2 items-center" title={serviceVersion}>
					<span className="truncate font-medium">{serviceVersion}</span>
				</div>
			);
		},
		enableHiding: false,
	},
	startedAt: {
		header: () => "Started At",
		cell: ({ row }) => {
			return (
				<div
					className="block items-center overflow-hidden text-ellipsis"
					title={row.StartedAt}
				>
					{row.StartedAt}
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
		enableHiding: true,
	},
};


export default function List({ agents, isLoading, isFetched }: {
	agents: Agent[];
	isLoading: boolean;
	isFetched: boolean;
}) {
	return (
		<DataTable
			columns={columns}
			data={agents}
			isFetched={isFetched}
			isLoading={isLoading}
			visibilityColumns={{
				id: true,
				name: true,
				version: true,
				startedAt: true,
				status: true,
			}}
		/>
	);
}
