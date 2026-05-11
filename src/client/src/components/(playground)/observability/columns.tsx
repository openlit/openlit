import { Columns } from "@/components/data-table/columns";
import { CalendarDays } from "lucide-react";
import { format } from "date-fns";

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
		header: () => "Time",
		cell: ({ row }) => (
			<div className="flex space-x-2 items-center" title={row.Timestamp}>
				<CalendarDays size="16" />
				<span className="truncate font-medium">{formatDate(row.Timestamp)}</span>
			</div>
		),
	},
	severityText: {
		header: () => "Severity",
		cell: ({ row }) => (
			<span className="truncate" title={row.SeverityText || "-"}>
				{row.SeverityText || "-"}
			</span>
		),
	},
	serviceName: {
		header: () => "Service",
		cell: ({ row }) => (
			<div className="truncate" title={row.ServiceName}>
				{row.ServiceName || "-"}
			</div>
		),
	},
	body: {
		header: () => "Body",
		cell: ({ row }) => (
			<div className="truncate" title={row.Body}>
				{row.Body || "-"}
			</div>
		),
	},
	traceId: {
		header: () => "Trace ID",
		cell: ({ row }) => (
			<div className="truncate font-mono text-xs" title={row.TraceId}>
				{row.TraceId || "-"}
			</div>
		),
	},
	spanId: {
		header: () => "Span ID",
		cell: ({ row }) => (
			<div className="truncate font-mono text-xs" title={row.SpanId}>
				{row.SpanId || "-"}
			</div>
		),
	},
};

export const metricColumns: Columns<string, MetricRow> = {
	metricName: {
		header: () => "Metric",
		cell: ({ row }) => (
			<div className="truncate font-medium" title={row.metricName}>
				{row.metricName}
			</div>
		),
	},
	metricType: {
		header: () => "Type",
		cell: ({ row }) => <span className="truncate">{row.metricType}</span>,
	},
	serviceName: {
		header: () => "Service",
		cell: ({ row }) => (
			<div className="truncate" title={row.serviceName}>
				{row.serviceName || "-"}
			</div>
		),
	},
	metricUnit: {
		header: () => "Unit",
		cell: ({ row }) => <span className="truncate">{row.metricUnit || "-"}</span>,
	},
	latestValue: {
		header: () => "Latest",
		cell: ({ row }) => (
			<span className="tabular-nums">
				{typeof row.latestValue === "number" ? row.latestValue.toFixed(4) : "-"}
			</span>
		),
	},
	pointCount: {
		header: () => "Points",
		cell: ({ row }) => (
			<span className="tabular-nums">{row.pointCount?.toLocaleString()}</span>
		),
	},
	lastSeen: {
		header: () => "Last Seen",
		cell: ({ row }) => (
			<div className="flex space-x-2 items-center" title={row.lastSeen}>
				<CalendarDays size="16" />
				<span className="truncate font-medium">{formatDate(row.lastSeen)}</span>
			</div>
		),
	},
};
