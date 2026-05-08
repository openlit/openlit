import { Columns } from "@/components/data-table/columns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TraceMapping } from "@/constants/traces";
import { TraceMappingKeyType, TransformedTraceRow } from "@/types/trace";
import { CalendarDays, Sparkles } from "lucide-react";

type RequestColumnKey = TraceMappingKeyType | "actions";

export const columns: Columns<RequestColumnKey, TransformedTraceRow> = {
	id: {
		header: () => TraceMapping.id.label,
		cell: ({ row }) => (
			<div
				className="rounded-md text-stone-700 dark:text-stone-300 block overflow-hidden text-ellipsis"
				title={row.id}
			>
				{row.id}
			</div>
		),
		enableHiding: false,
	},
	time: {
		header: () => TraceMapping.time.label,
		cell: ({ row }) => {
			return (
				<div className="flex space-x-2 items-center" title={row.time}>
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
			return (
				<div className="truncate" title={row.spanName}>
					{row.spanName}
				</div>
			);
		},
	},
	requestDuration: {
		header: () => TraceMapping.requestDuration.label,
		cell: ({ row }) => {
			const value = `${parseFloat(row.requestDuration).toFixed(3)}${
				TraceMapping.requestDuration.valueSuffix
			}`;
			return (
				<div className="truncate" title={value}>
					{value}
				</div>
			);
		},
		enableHiding: true,
	},
	serviceName: {
		header: () => TraceMapping.serviceName.label,
		cell: ({ row }) => {
			return (
				<div className="truncate" title={row.serviceName}>
					{row.serviceName}
				</div>
			);
		},
		enableHiding: true,
	},
	applicationName: {
		header: () => TraceMapping.applicationName.label,
		cell: ({ row }) => {
			return (
				<div className="truncate" title={row.applicationName}>
					{row.applicationName}
				</div>
			);
		},
		enableHiding: true,
	},
	cost: {
		header: () => TraceMapping.cost.label,
		cell: ({ row }) => {
			const value = `${TraceMapping.cost.valuePrefix}${row.cost}`;
			return (
				<div className="truncate" title={value}>
					{value}
				</div>
			);
		},
		enableHiding: true,
	},
	totalTokens: {
		header: () => TraceMapping.totalTokens.label,
		cell: ({ row }) => {
			return (
				<div className="truncate" title={row.totalTokens}>
					{row.totalTokens}
				</div>
			);
		},
		enableHiding: true,
	},
	model: {
		header: () => TraceMapping.model.label,
		cell: ({ row }) => {
			return (
				<div className="truncate" title={row.model}>
					{row.model}
				</div>
			);
		},
		enableHiding: true,
	},
	system: {
		header: () => TraceMapping.system.label,
		cell: ({ row }) => {
			return (
				<div className="truncate" title={row.system}>
					{row.system}
				</div>
			);
		},
		enableHiding: true,
	},
	vectorCount: {
		header: () => TraceMapping.vectorCount.label,
		cell: ({ row }) => {
			return (
				<div className="truncate" title={row.vectorCount}>
					{row.vectorCount}
				</div>
			);
		},
		enableHiding: true,
	},
	actions: {
		header: () => "",
		cell: ({ row, extraFunctions }) => {
			const severity = extraFunctions?.getAnalysisStatus?.(row.spanId) || "";
			const isSelected = extraFunctions?.isCompareSelected?.(row.spanId) || false;

			const dotColor =
				severity === "critical"
					? "bg-red-500"
					: severity === "major"
						? "bg-orange-400"
						: severity === "minor"
							? "bg-yellow-400"
							: severity === "info"
								? "bg-blue-400"
								: severity === "none"
									? "bg-green-400"
									: "";

			return (
				<div className="flex items-center gap-1.5">
					{severity && (
						<span
							className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`}
							title={`Analysis: ${severity}`}
						/>
					)}
					<Button
						size="xs"
						variant="ghost"
						className="gap-1.5"
						onClick={(event) => {
							event.stopPropagation();
							extraFunctions?.analyzeWithCopilot?.(row);
						}}
					>
						<Sparkles className="h-3.5 w-3.5" />
						Analyze
					</Button>
					{extraFunctions?.toggleCompare && (
						<Checkbox
							checked={isSelected}
							onClick={(event) => event.stopPropagation()}
							onCheckedChange={() => extraFunctions.toggleCompare!(row.spanId)}
							aria-label="Select for comparison"
							className="h-3.5 w-3.5"
						/>
					)}
				</div>
			);
		},
		enableHiding: false,
	},
};
