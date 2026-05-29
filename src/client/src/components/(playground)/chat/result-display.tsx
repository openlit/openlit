"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Save, Table, BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon } from "lucide-react";
import getMessage from "@/constants/messages";
import SaveWidgetDialog from "./save-widget-dialog";
import {
	ResponsiveContainer,
	LineChart,
	Line,
	BarChart,
	Bar,
	PieChart,
	Pie,
	Cell,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	Legend,
} from "recharts";

type VizType = "TABLE" | "BAR_CHART" | "LINE_CHART" | "PIE_CHART" | "AREA_CHART" | "STAT_CARD";

interface ResultDisplayProps {
	data: any[];
	stats?: {
		rowsRead?: number;
		executionTimeMs?: number;
		bytesRead?: number;
	};
	query: string;
}

const CHART_COLORS = [
	"#F36C06", "#3b82f6", "#10b981", "#8b5cf6",
	"#f59e0b", "#ef4444", "#06b6d4", "#ec4899",
];

function formatNumber(val: unknown): string {
	if (val === null || val === undefined) return "";
	const num = Number(val);
	if (isNaN(num)) return String(val);
	if (Number.isInteger(num)) return num.toLocaleString();
	// Preserve up to 10 decimal places, strip trailing zeros
	return parseFloat(num.toFixed(10)).toString();
}

function detectVizType(data: any[]): VizType {
	if (!data || data.length === 0) return "TABLE";

	const columns = Object.keys(data[0]);
	const numericCols = columns.filter((col) => {
		const val = data[0][col];
		return typeof val === "number" || (!isNaN(Number(val)) && val !== "" && val !== null);
	});
	const stringCols = columns.filter((col) => !numericCols.includes(col));

	if (data.length === 1 && numericCols.length >= 1 && numericCols.length <= 2) {
		return "STAT_CARD";
	}

	const hasTimestamp = columns.some((col) => {
		const lower = col.toLowerCase();
		return (
			lower.includes("time") || lower.includes("hour") ||
			lower.includes("day") || lower.includes("date") ||
			lower.includes("minute")
		);
	});

	if (hasTimestamp && numericCols.length >= 1 && data.length > 1) {
		return "LINE_CHART";
	}

	if (columns.length === 2 && stringCols.length === 1 && numericCols.length === 1 && data.length > 1) {
		return "BAR_CHART";
	}

	return "TABLE";
}

function getColumnTypes(data: any[]) {
	if (!data || data.length === 0) return { numericCols: [] as string[], labelCols: [] as string[] };
	const columns = Object.keys(data[0]);
	const numericCols = columns.filter((col) => {
		const val = data[0][col];
		return typeof val === "number" || (!isNaN(Number(val)) && val !== "" && val !== null);
	});
	const labelCols = columns.filter((col) => !numericCols.includes(col));
	return { numericCols, labelCols };
}

const VIZ_OPTIONS: { type: VizType; icon: React.ElementType; label: string }[] = [
	{ type: "TABLE", icon: Table, label: "Table" },
	{ type: "BAR_CHART", icon: BarChart3, label: "Bar" },
	{ type: "LINE_CHART", icon: LineChartIcon, label: "Line" },
	{ type: "PIE_CHART", icon: PieChartIcon, label: "Pie" },
];

export default function ResultDisplay({ data, stats, query }: ResultDisplayProps) {
	const m = getMessage();
	const detectedType = useMemo(() => detectVizType(data), [data]);
	const [vizType, setVizType] = useState<VizType>(detectedType);
	const [showSaveDialog, setShowSaveDialog] = useState(false);

	if (!data || data.length === 0) {
		return (
			<div className="px-4 py-6 text-center text-sm text-stone-400 dark:text-stone-500">
				{m.CHAT_NO_DATA_RETURNED}
			</div>
		);
	}

	const columns = Object.keys(data[0]);

	return (
		<div className="bg-white dark:bg-stone-900">
			<div className="flex items-center justify-between px-3 py-2 border-b border-stone-200 dark:border-stone-700">
				<div className="flex items-center gap-1">
					{VIZ_OPTIONS.map(({ type, icon: Icon, label }) => (
						<Button
							key={type}
							variant={vizType === type ? "default" : "ghost"}
							size="sm"
							className="h-7 px-2 text-xs"
							onClick={() => setVizType(type)}
						>
							<Icon className="h-3 w-3 mr-1" />
							{label}
						</Button>
					))}
				</div>
				<div className="flex items-center gap-3">
					{stats && (
						<span className="text-xs text-stone-400 dark:text-stone-500">
							{data.length} {m.CHAT_ROWS}
							{stats.executionTimeMs ? ` in ${stats.executionTimeMs}ms` : ""}
						</span>
					)}
					<Button
						variant="outline"
						size="sm"
						className="h-7 px-2 text-xs border-stone-200 dark:border-stone-700"
						onClick={() => setShowSaveDialog(true)}
					>
						<Save className="h-3 w-3 mr-1" />
						{m.CHAT_SAVE_AS_WIDGET}
					</Button>
				</div>
			</div>

			<div className="p-4 max-h-[400px] overflow-auto">
				{vizType === "STAT_CARD" && <StatCardView data={data} />}
				{vizType === "TABLE" && <TableView data={data} columns={columns} />}
				{vizType === "BAR_CHART" && <RechartsBarChart data={data} />}
				{vizType === "LINE_CHART" && <RechartsLineChart data={data} />}
				{vizType === "PIE_CHART" && <RechartsPieChart data={data} />}
			</div>

			{showSaveDialog && (
				<SaveWidgetDialog
					open={showSaveDialog}
					onClose={() => setShowSaveDialog(false)}
					query={query}
					suggestedType={vizType}
					data={data}
				/>
			)}
		</div>
	);
}

function StatCardView({ data }: { data: any[] }) {
	const row = data[0];
	return (
		<div className="flex items-center gap-6 justify-center py-4">
			{Object.entries(row).map(([key, value]) => (
				<div key={key} className="text-center">
					<p className="text-3xl font-bold text-stone-900 dark:text-stone-100">
						{formatNumber(value)}
					</p>
					<p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
						{key.replace(/_/g, " ")}
					</p>
				</div>
			))}
		</div>
	);
}

function TableView({ data, columns }: { data: any[]; columns: string[] }) {
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-b border-stone-200 dark:border-stone-700">
					{columns.map((col) => (
						<th key={col} className="px-3 py-2 text-left text-xs font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wider">
							{col.replace(/_/g, " ")}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{data.map((row, i) => (
					<tr key={i} className="border-b border-stone-100 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/50">
						{columns.map((col) => (
							<td key={col} className="px-3 py-2 text-stone-700 dark:text-stone-300 font-mono text-xs">
								{typeof row[col] === "object"
									? JSON.stringify(row[col])
									: formatNumber(row[col])}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}

function RechartsBarChart({ data }: { data: any[] }) {
	const { numericCols, labelCols } = getColumnTypes(data);
	const xKey = labelCols[0] || Object.keys(data[0])[0];
	const yKeys = numericCols.length > 0 ? numericCols : [Object.keys(data[0])[1]];

	// Convert string numbers to actual numbers for Recharts
	const chartData = data.map((row) => {
		const newRow: Record<string, any> = { ...row };
		yKeys.forEach((k) => {
			newRow[k] = Number(row[k]) || 0;
		});
		return newRow;
	});

	return (
		<div className="h-[300px] w-full">
			<ResponsiveContainer width="100%" height="100%">
				<BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
					<CartesianGrid strokeDasharray="3 3" className="stroke-stone-200 dark:stroke-stone-700" />
					<XAxis
						dataKey={xKey}
						tick={{ fontSize: 11 }}
						className="text-stone-500 dark:text-stone-400"
					/>
					<YAxis
						tick={{ fontSize: 11 }}
						className="text-stone-500 dark:text-stone-400"
						tickFormatter={(v) => formatNumber(v)}
					/>
					<Tooltip
						contentStyle={{
							backgroundColor: "var(--tooltip-bg, #fff)",
							border: "1px solid var(--tooltip-border, #e7e5e4)",
							borderRadius: "8px",
							fontSize: "12px",
						}}
						formatter={(value: any) => formatNumber(value)}
					/>
					{yKeys.length > 1 && <Legend />}
					{yKeys.map((key, i) => (
						<Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
					))}
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}

function RechartsLineChart({ data }: { data: any[] }) {
	const { numericCols, labelCols } = getColumnTypes(data);
	const xKey = labelCols[0] || Object.keys(data[0])[0];
	const yKeys = numericCols.length > 0 ? numericCols : [Object.keys(data[0])[1]];

	const chartData = data.map((row) => {
		const newRow: Record<string, any> = { ...row };
		yKeys.forEach((k) => {
			newRow[k] = Number(row[k]) || 0;
		});
		return newRow;
	});

	return (
		<div className="h-[300px] w-full">
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
					<CartesianGrid strokeDasharray="3 3" className="stroke-stone-200 dark:stroke-stone-700" />
					<XAxis
						dataKey={xKey}
						tick={{ fontSize: 11 }}
						className="text-stone-500 dark:text-stone-400"
					/>
					<YAxis
						tick={{ fontSize: 11 }}
						className="text-stone-500 dark:text-stone-400"
						tickFormatter={(v) => formatNumber(v)}
					/>
					<Tooltip
						contentStyle={{
							backgroundColor: "var(--tooltip-bg, #fff)",
							border: "1px solid var(--tooltip-border, #e7e5e4)",
							borderRadius: "8px",
							fontSize: "12px",
						}}
						formatter={(value: any) => formatNumber(value)}
					/>
					{yKeys.length > 1 && <Legend />}
					{yKeys.map((key, i) => (
						<Line
							key={key}
							type="monotone"
							dataKey={key}
							stroke={CHART_COLORS[i % CHART_COLORS.length]}
							strokeWidth={2}
							dot={{ r: 3 }}
							activeDot={{ r: 5 }}
						/>
					))}
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

function RechartsPieChart({ data }: { data: any[] }) {
	const { numericCols, labelCols } = getColumnTypes(data);
	const nameKey = labelCols[0] || Object.keys(data[0])[0];
	const valueKey = numericCols[0] || Object.keys(data[0])[1];

	const chartData = data.map((row) => ({
		name: String(row[nameKey] ?? ""),
		value: Number(row[valueKey]) || 0,
	}));

	return (
		<div className="h-[300px] w-full">
			<ResponsiveContainer width="100%" height="100%">
				<PieChart>
					<Pie
						data={chartData}
						dataKey="value"
						nameKey="name"
						cx="50%"
						cy="50%"
						outerRadius={100}
						label={({ name, percent }) =>
							`${name} (${(percent * 100).toFixed(1)}%)`
						}
						labelLine={{ strokeWidth: 1 }}
					>
						{chartData.map((_, i) => (
							<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
						))}
					</Pie>
					<Tooltip formatter={(value: any) => formatNumber(value)} />
					<Legend />
				</PieChart>
			</ResponsiveContainer>
		</div>
	);
}
