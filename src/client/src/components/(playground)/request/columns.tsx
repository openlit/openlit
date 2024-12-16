import { Columns } from "@/components/data-table/columns";
import { Badge } from "@/components/ui/badge";
import {
	TraceMapping,
	TraceMappingKeyType,
	TransformedTraceRow,
} from "@/constants/traces";
import { CalendarDays } from "lucide-react";

export const columns: Columns<TraceMappingKeyType, TransformedTraceRow> = {
	id: {
		header: () => TraceMapping.id.label,
		cell: ({ row }) => (
			<Badge
				variant="outline"
				className="rounded-md text-stone-700 dark:text-stone-300"
			>
				{row.id}
			</Badge>
		),
		enableHiding: false,
	},
	time: {
		header: () => TraceMapping.time.label,
		cell: ({ row }) => {
			return (
				<div className="flex space-x-2 items-center">
					<CalendarDays size="16" />
					<span className="truncate font-medium">{row.time}</span>
				</div>
			);
		},
		enableHiding: false,
	},
	spanName: {
		header: () => TraceMapping.spanName.label,
		cell: ({ row }) => {
			return <div className="flex items-center">{row.spanName}</div>;
		},
	},
	requestDuration: {
		header: () => TraceMapping.requestDuration.label,
		cell: ({ row }) => {
			return (
				<div className="flex items-center">
					{parseFloat(row.requestDuration).toFixed(3)}
					{TraceMapping.requestDuration.valueSuffix}
				</div>
			);
		},
		enableHiding: true,
	},
	serviceName: {
		header: () => TraceMapping.serviceName.label,
		cell: ({ row }) => {
			return <div className="flex items-center">{row.serviceName}</div>;
		},
		enableHiding: true,
	},
	applicationName: {
		header: () => TraceMapping.applicationName.label,
		cell: ({ row }) => {
			return <div className="flex items-center">{row.applicationName}</div>;
		},
		enableHiding: true,
	},
	cost: {
		header: () => TraceMapping.cost.label,
		cell: ({ row }) => {
			return (
				<div className="flex items-center">
					{TraceMapping.cost.valuePrefix}
					{row.cost}
				</div>
			);
		},
		enableHiding: true,
	},
	totalTokens: {
		header: () => TraceMapping.totalTokens.label,
		cell: ({ row }) => {
			return <div className="flex items-center">{row.totalTokens}</div>;
		},
		enableHiding: true,
	},
};
