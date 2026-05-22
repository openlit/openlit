import { Columns } from "@/components/data-table/columns";
import { columns as traceColumns } from "@/components/(playground)/request/columns";
import { columns as exceptionColumns } from "@/components/(playground)/exceptions/columns";
import { logColumns, metricColumns } from "./columns";
import { normalizeTrace } from "@/helpers/client/trace";
import {
	Activity,
	BarChart3,
	FileText,
	ShieldAlert,
	type LucideIcon,
} from "lucide-react";
import { CustomFilterAttributeType } from "@/types/store/filter";
import { PAGE } from "@/types/store/page";
import getMessage from "@/constants/messages";

const m = getMessage();

export type ObservabilitySignal = "traces" | "exceptions" | "metrics" | "logs";

export type ObservabilitySignalConfig = {
	key: ObservabilitySignal;
	label: string;
	shortLabel: string;
	tone: string;
	summary: string;
	icon: LucideIcon;
	listUrl: string;
	summaryUrl: string;
	configUrl: string;
	attributeKeysUrl: string;
	columns: Columns<any, any>;
	pageName: PAGE;
	visibilityPage: PAGE;
	supportGrouping?: boolean;
	groupedUrl?: string;
	includeOnlySorting?: string[];
	customAttributeTypes: CustomFilterAttributeType[];
	normalize?: (row: any) => any;
	getRowId: (row: any) => string;
	getDetailHref: (row: any, from: string) => string;
};

export const OBSERVABILITY_SIGNALS: ObservabilitySignalConfig[] = [
	{
		key: "traces",
		label: m.OBSERVABILITY_TRACES,
		shortLabel: m.OBSERVABILITY_TRACE_SHORT_LABEL,
		tone: "text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-900",
		summary: m.OBSERVABILITY_TRACE_SUMMARY,
		icon: Activity,
		listUrl: "/api/metrics/request",
		summaryUrl: "/api/telemetry/summary/traces",
		configUrl: "/api/metrics/request/config",
		attributeKeysUrl: "/api/metrics/request/attribute-keys",
		columns: traceColumns,
		pageName: "request",
		visibilityPage: "request",
		supportGrouping: true,
		groupedUrl: "/api/metrics/request/grouped",
		customAttributeTypes: ["SpanAttributes", "ResourceAttributes", "Field"],
		normalize: normalizeTrace,
		getRowId: (row) => row.spanId,
		getDetailHref: (row, from) =>
			`/telemetry/traces/${row.spanId}?from=${encodeURIComponent(from)}`,
	},
	{
		key: "exceptions",
		label: m.OBSERVABILITY_EXCEPTIONS,
		shortLabel: m.OBSERVABILITY_EXCEPTION_SHORT_LABEL,
		tone: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900",
		summary: m.OBSERVABILITY_EXCEPTION_SUMMARY,
		icon: ShieldAlert,
		listUrl: "/api/metrics/exception",
		summaryUrl: "/api/telemetry/summary/exceptions",
		configUrl: "/api/metrics/request/config",
		attributeKeysUrl: "/api/metrics/request/attribute-keys",
		columns: exceptionColumns,
		pageName: "exception",
		visibilityPage: "exception",
		supportGrouping: true,
		groupedUrl: "/api/metrics/exception/grouped",
		includeOnlySorting: ["Timestamp"],
		customAttributeTypes: ["SpanAttributes", "ResourceAttributes", "Field"],
		normalize: normalizeTrace,
		getRowId: (row) => row.spanId,
		getDetailHref: (row, from) =>
			`/telemetry/exceptions/${row.spanId}?from=${encodeURIComponent(from)}`,
	},
	{
		key: "metrics",
		label: m.OBSERVABILITY_METRICS,
		shortLabel: m.OBSERVABILITY_METRIC_SHORT_LABEL,
		tone: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900",
		summary: m.OBSERVABILITY_METRIC_SUMMARY,
		icon: BarChart3,
		listUrl: "/api/telemetry/metrics",
		summaryUrl: "/api/telemetry/summary/metrics",
		configUrl: "/api/telemetry/metrics/config",
		attributeKeysUrl: "/api/telemetry/metrics/attribute-keys",
		columns: metricColumns,
		pageName: "observabilityMetrics",
		visibilityPage: "observabilityMetrics",
		customAttributeTypes: [
			"Attributes",
			"ResourceAttributes",
			"ScopeAttributes",
			"Field",
		],
		getRowId: (row) => `${row.metricType}:${row.serviceName}:${row.metricName}`,
		getDetailHref: (row, from) => {
			const query = new URLSearchParams({
				from,
				metricType: row.metricType || "",
				serviceName: row.serviceName || "",
			});
			return `/telemetry/metrics/${encodeURIComponent(row.metricName)}?${query.toString()}`;
		},
	},
	{
		key: "logs",
		label: m.OBSERVABILITY_LOGS,
		shortLabel: m.OBSERVABILITY_LOG_SHORT_LABEL,
		tone: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900",
		summary: m.OBSERVABILITY_LOG_SUMMARY,
		icon: FileText,
		listUrl: "/api/telemetry/logs",
		summaryUrl: "/api/telemetry/summary/logs",
		configUrl: "/api/telemetry/logs/config",
		attributeKeysUrl: "/api/telemetry/logs/attribute-keys",
		columns: logColumns,
		pageName: "observabilityLogs",
		visibilityPage: "observabilityLogs",
		includeOnlySorting: ["Timestamp", "SeverityNumber"],
		customAttributeTypes: [
			"LogAttributes",
			"ResourceAttributes",
			"ScopeAttributes",
			"Field",
		],
		getRowId: (row) => String(row.rowId),
		getDetailHref: (row, from) =>
			`/telemetry/logs/${row.rowId}?from=${encodeURIComponent(from)}`,
	},
];

export function getSignalConfig(signal: string | null | undefined) {
	return (
		OBSERVABILITY_SIGNALS.find((item) => item.key === signal) ||
		OBSERVABILITY_SIGNALS[0]
	);
}
