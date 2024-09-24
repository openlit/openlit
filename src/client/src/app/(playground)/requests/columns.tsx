"use client";

import { ColumnDef } from "@tanstack/react-table";

// import { Badge } from "@/components/ui/badge"

import { TraceSchema } from "@/constants/traces";

// import { DataTableRowActions } from "./data-table-row-actions"
import DataTableColumnHeader from "@/components/data-table/column-header";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const columns: ColumnDef<TraceSchema>[] = [
	{
		accessorKey: "id",
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="TraceId" />
		),
		cell: ({ row }) => (
			<div className="w-[80px]">
				<Badge variant="outline" className="rounded-md">
					...{row.original.TraceId.substring(row.original.TraceId.length - 6)}
				</Badge>
			</div>
		),
		enableSorting: false,
		enableHiding: false,
	},
	{
		accessorKey: "title",
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="Timestamp" />
		),
		cell: ({ row }) => {
			// const label = labels.find((label) => label.value === row.original.label)
			const date = new Date(`${row.original.Timestamp}Z`);
			console.log(row, date);
			return (
				<div className="flex space-x-2">
					{/* {label && <Badge variant="outline">{label.label}</Badge>} */}
					<CalendarDays size="16" />
					<span className="max-w-[500px] truncate font-medium">
						{format(date, "MMM do, y  HH:mm:ss a")}
					</span>
				</div>
			);
		},
	},
	{
		accessorKey: "status",
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="Status" />
		),
		cell: ({ row }) => {
			// const status = statuses.find(
			//   (status) => status.value === row.getValue("status")
			// )

			// if (!status) {
			//   return null
			// }

			return (
				<div className="flex w-[100px] items-center">
					{/* {status.icon && (
            <status.icon className="mr-2 h-4 w-4 text-muted-foreground" />
          )}
          <span>{status.label}</span> */}
				</div>
			);
		},
		filterFn: (row, id, value) => {
			return value.includes(row.getValue(id));
		},
	},
	{
		accessorKey: "priority",
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="Priority" />
		),
		cell: ({ row }) => {
			// const priority = priorities.find(
			//   (priority) => priority.value === row.getValue("priority")
			// )

			// if (!priority) {
			//   return null
			// }

			return (
				<div className="flex items-center">
					{/* {priority.icon && (
            <priority.icon className="mr-2 h-4 w-4 text-muted-foreground" />
          )}
          <span>{priority.label}</span> */}
				</div>
			);
		},
		filterFn: (row, id, value) => {
			return value.includes(row.getValue(id));
		},
	},
	// {
	//   id: "actions",
	//   cell: ({ row }) => <DataTableRowActions row={row} />,
	// },
];
