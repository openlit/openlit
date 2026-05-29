import { Columns } from "@/components/data-table/columns";
import { CalendarDays } from "lucide-react";
import { format } from "date-fns";
import getMessage from "@/constants/messages";

const m = getMessage();

export type LogRow = {
	rowId: string | number;
	Timestamp: string;
	TraceId: string;
	SpanId: string;
	SeverityText: string;
	ServiceName: string;
	Body: string;
};

export type MetricRow = {
	metricName: string;
	metricType: string;
	serviceName: string;
	metricUnit?: string;
	latestValue?: number;
	avgValue?: number;
	minValue?: number;
	maxValue?: number;
	pointCount: number;
	lastSeen: string;
};

function formatDate(value?: string) {
	if (!value) return "-";
	try {
		return format(new Date(value), "MMM d, HH:mm:ss");
	} catch {
		return value;
	}
}

export const logColumns: Columns<string, LogRow> = {
	time: {
		header: () => m.OBSERVABILITY_TIME,
		cell: ({ row }) => (
			<div className="flex space-x-2 items-center" title={row.Timestamp}>
				<CalendarDays size="16" />
				<span className="truncate font-medium">{formatDate(row.Timestamp)}</span>
			</div>
		),
		enableHiding: true,
	},
	severityText: {
		header: () => m.OBSERVABILITY_SEVERITY,
		cell: ({ row }) => (
			<span className="truncate" title={row.SeverityText || "-"}>
				{row.SeverityText || "-"}
			</span>
		),
		enableHiding: true,
	},
	serviceName: {
		header: () => m.OBSERVABILITY_SERVICE,
		cell: ({ row }) => (
			<div className="truncate" title={row.ServiceName}>
				{row.ServiceName || "-"}
			</div>
		),
		enableHiding: true,
	},
	body: {
		header: () => m.OBSERVABILITY_BODY,
		cell: ({ row }) => (
			<div className="truncate" title={row.Body}>
				{row.Body || "-"}
			</div>
		),
		enableHiding: true,
	},
	traceId: {
		header: () => m.OBSERVABILITY_TRACE_ID,
		cell: ({ row }) => (
			<div className="truncate font-mono text-xs" title={row.TraceId}>
				{row.TraceId || "-"}
			</div>
		),
		enableHiding: true,
	},
	spanId: {
		header: () => m.OBSERVABILITY_SPAN_ID,
		cell: ({ row }) => (
			<div className="truncate font-mono text-xs" title={row.SpanId}>
				{row.SpanId || "-"}
			</div>
		),
		enableHiding: true,
	},
};

export const metricColumns: Columns<string, MetricRow> = {
	metricName: {
		header: () => m.OBSERVABILITY_METRIC,
		cell: ({ row }) => (
			<div className="truncate font-medium" title={row.metricName}>
				{row.metricName}
			</div>
		),
		enableHiding: true,
	},
	metricType: {
		header: () => m.OBSERVABILITY_TYPE,
		cell: ({ row }) => <span className="truncate">{row.metricType}</span>,
		enableHiding: true,
	},
	serviceName: {
		header: () => m.OBSERVABILITY_SERVICE,
		cell: ({ row }) => (
			<div className="truncate" title={row.serviceName}>
				{row.serviceName || "-"}
			</div>
		),
		enableHiding: true,
	},
	metricUnit: {
		header: () => m.OBSERVABILITY_UNIT,
		cell: ({ row }) => <span className="truncate">{row.metricUnit || "-"}</span>,
		enableHiding: true,
	},
	latestValue: {
		header: () => m.OBSERVABILITY_LATEST,
		cell: ({ row }) => (
			<span className="tabular-nums">
				{typeof row.latestValue === "number" ? row.latestValue.toFixed(4) : "-"}
			</span>
		),
		enableHiding: true,
	},
	pointCount: {
		header: () => m.OBSERVABILITY_POINTS,
		cell: ({ row }) => (
			<span className="tabular-nums">{row.pointCount?.toLocaleString()}</span>
		),
		enableHiding: true,
	},
	lastSeen: {
		header: () => m.OBSERVABILITY_LAST_SEEN,
		cell: ({ row }) => (
			<div className="flex space-x-2 items-center" title={row.lastSeen}>
				<CalendarDays size="16" />
				<span className="truncate font-medium">{formatDate(row.lastSeen)}</span>
			</div>
		),
		enableHiding: true,
	},
};
