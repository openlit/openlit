"use client";

import type React from "react";

import { useState, useRef } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
	Edit,
	Trash,
	Save,
	Plus,
	BarChart3,
	LineChart,
	PieChart,
	Activity,
	Database,
	Maximize2,
	Minimize2,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import {
	LineChart as RechartsLineChart,
	Line,
	BarChart as RechartsBarChart,
	Bar,
	PieChart as RechartsPieChart,
	Pie,
	Cell,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetDescription,
	SheetFooter,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

const ResponsiveGridLayout = WidthProvider(Responsive);

// Widget types
const WIDGET_TYPES = {
	STAT_CARD: "stat_card",
	BAR_CHART: "bar_chart",
	LINE_CHART: "line_chart",
	PIE_CHART: "pie_chart",
	TABLE: "table",
};

// Widget type icons
const WIDGET_TYPE_ICONS = {
	[WIDGET_TYPES.STAT_CARD]: Activity,
	[WIDGET_TYPES.BAR_CHART]: BarChart3,
	[WIDGET_TYPES.LINE_CHART]: LineChart,
	[WIDGET_TYPES.PIE_CHART]: PieChart,
	[WIDGET_TYPES.TABLE]: Database,
};

// Color palette for charts
const CHART_COLORS = {
	blue: ["#0ea5e9", "#38bdf8", "#7dd3fc", "#bae6fd"],
	green: ["#10b981", "#34d399", "#6ee7b7", "#a7f3d0"],
	red: ["#ef4444", "#f87171", "#fca5a5", "#fecaca"],
	purple: ["#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe"],
	orange: ["#f97316", "#fb923c", "#fdba74", "#fed7aa"],
};

// Initial layout configuration
const initialLayouts = {
	lg: [
		{ i: "widget-1", x: 0, y: 0, w: 2, h: 2 },
		{ i: "widget-2", x: 2, y: 0, w: 2, h: 2 },
		{ i: "widget-3", x: 0, y: 2, w: 4, h: 2 },
		{ i: "widget-4", x: 0, y: 4, w: 2, h: 2 },
		{ i: "widget-5", x: 2, y: 4, w: 2, h: 2 },
	],
};

// Initial widget data
const initialWidgets = {
	"widget-1": {
		title: "Total Users",
		type: WIDGET_TYPES.STAT_CARD,
		query: "SELECT count() FROM users",
		description: "Shows the total number of users in the system",
		value: "1,234",
		properties: {
			prefix: "",
			suffix: "",
			color: "blue",
			trend: "+12%",
			trendDirection: "up",
		},
	},
	"widget-2": {
		title: "Revenue by Month",
		type: WIDGET_TYPES.BAR_CHART,
		query:
			"SELECT toMonth(date) as month, sum(amount) as revenue\nFROM orders\nGROUP BY month\nORDER BY month",
		description: "Monthly revenue breakdown",
		data: [
			{ month: "Jan", revenue: 12000 },
			{ month: "Feb", revenue: 15000 },
			{ month: "Mar", revenue: 18000 },
			{ month: "Apr", revenue: 16000 },
			{ month: "May", revenue: 21000 },
			{ month: "Jun", revenue: 19000 },
		],
		properties: {
			xAxis: "month",
			yAxis: "revenue",
			color: "green",
		},
	},
	"widget-3": {
		title: "Active Users",
		type: WIDGET_TYPES.LINE_CHART,
		query:
			"SELECT date, count() as active_users\nFROM user_sessions\nGROUP BY date\nORDER BY date",
		description: "Daily active users over time",
		data: [
			{ date: "2023-01-01", active_users: 500 },
			{ date: "2023-01-02", active_users: 520 },
			{ date: "2023-01-03", active_users: 580 },
			{ date: "2023-01-04", active_users: 620 },
			{ date: "2023-01-05", active_users: 670 },
			{ date: "2023-01-06", active_users: 650 },
			{ date: "2023-01-07", active_users: 700 },
		],
		properties: {
			xAxis: "date",
			yAxis: "active_users",
			color: "purple",
		},
	},
	"widget-4": {
		title: "User Distribution",
		type: WIDGET_TYPES.PIE_CHART,
		query: "SELECT user_type, count() as count\nFROM users\nGROUP BY user_type",
		description: "Distribution of users by type",
		data: [
			{ name: "Free", value: 800 },
			{ name: "Basic", value: 300 },
			{ name: "Premium", value: 100 },
			{ name: "Enterprise", value: 50 },
		],
		properties: {
			color: "blue",
		},
	},
	"widget-5": {
		title: "Recent Orders",
		type: WIDGET_TYPES.TABLE,
		query:
			"SELECT id, customer_name, amount, status, order_date\nFROM orders\nORDER BY order_date DESC\nLIMIT 5",
		description: "Most recent customer orders",
		data: [
			{
				id: "ORD-001",
				customer_name: "John Doe",
				amount: 125.99,
				status: "Completed",
				order_date: "2023-01-07",
			},
			{
				id: "ORD-002",
				customer_name: "Jane Smith",
				amount: 89.5,
				status: "Processing",
				order_date: "2023-01-06",
			},
			{
				id: "ORD-003",
				customer_name: "Bob Johnson",
				amount: 245.0,
				status: "Completed",
				order_date: "2023-01-05",
			},
			{
				id: "ORD-004",
				customer_name: "Alice Brown",
				amount: 32.75,
				status: "Shipped",
				order_date: "2023-01-04",
			},
			{
				id: "ORD-005",
				customer_name: "Charlie Wilson",
				amount: 178.25,
				status: "Processing",
				order_date: "2023-01-03",
			},
		],
		properties: {
			color: "orange",
		},
	},
};

// ClickHouse SQL language configuration for Monaco Editor
const clickhouseLanguageConfig: any = {
	id: "clickhouse-sql",
	extensions: [".sql"],
	aliases: ["ClickHouse SQL", "clickhouse-sql"],
	mimetypes: ["application/sql"],
	loader: () => ({
		language: {
			defaultToken: "",
			tokenPostfix: ".sql",
			ignoreCase: true,
			brackets: [
				{ open: "[", close: "]", token: "delimiter.square" },
				{ open: "(", close: ")", token: "delimiter.parenthesis" },
			],
			keywords: [
				"SELECT",
				"FROM",
				"WHERE",
				"AND",
				"OR",
				"GROUP",
				"BY",
				"ORDER",
				"HAVING",
				"LIMIT",
				"OFFSET",
				"INSERT",
				"INTO",
				"VALUES",
				"UPDATE",
				"DELETE",
				"SET",
				"CREATE",
				"ALTER",
				"DROP",
				"TABLE",
				"VIEW",
				"INDEX",
				"TRIGGER",
				"PROCEDURE",
				"FUNCTION",
				"DATABASE",
				"SCHEMA",
				"GRANT",
				"REVOKE",
				"COMMIT",
				"ROLLBACK",
				"SAVEPOINT",
				"TRANSACTION",
				"JOIN",
				"INNER",
				"OUTER",
				"LEFT",
				"RIGHT",
				"FULL",
				"UNION",
				"ALL",
				"AS",
				"DISTINCT",
				"CASE",
				"WHEN",
				"THEN",
				"ELSE",
				"END",
				"EXISTS",
				"IN",
				"LIKE",
				"BETWEEN",
				"IS",
				"NULL",
				"NOT",
				"DEFAULT",
				"CAST",
				"COLUMN",
				"COLUMNS",
				"USE",
				"PREWHERE",
				"TOP",
				"DESCRIBE",
				"OPTIMIZE",
				"FINAL",
				"SAMPLE",
				"SETTINGS",
				"FORMAT",
				"ARRAY",
				"TUPLE",
				"MAP",
				"WITH",
				"TOTALS",
				"HAVING",
				"GLOBAL",
				"USING",
				"ALIAS",
				"OUTFILE",
				"INFILE",
				"toDate",
				"toDateTime",
				"toUInt8",
				"toUInt16",
				"toUInt32",
				"toUInt64",
				"toInt8",
				"toInt16",
				"toInt32",
				"toInt64",
				"toFloat32",
				"toFloat64",
				"toDecimal32",
				"toDecimal64",
				"toDecimal128",
				"toString",
				"toFixedString",
				"toStringCutToZero",
				"reinterpretAsUInt8",
				"reinterpretAsUInt16",
				"reinterpretAsUInt32",
				"reinterpretAsUInt64",
				"reinterpretAsInt8",
				"reinterpretAsInt16",
				"reinterpretAsInt32",
				"reinterpretAsInt64",
				"reinterpretAsFloat32",
				"reinterpretAsFloat64",
				"reinterpretAsDate",
				"reinterpretAsDateTime",
				"reinterpretAsString",
				"toYear",
				"toMonth",
				"toDayOfMonth",
				"toDayOfWeek",
				"toHour",
				"toMinute",
				"toSecond",
				"toMonday",
				"toStartOfMonth",
				"toStartOfQuarter",
				"toStartOfYear",
				"toStartOfMinute",
				"toStartOfFiveMinute",
				"toStartOfHour",
				"toTime",
				"toRelativeYearNum",
				"toRelativeMonthNum",
				"toRelativeDayNum",
				"toRelativeHourNum",
				"toRelativeMinuteNum",
				"toRelativeSecondNum",
				"now",
				"today",
				"yesterday",
				"if",
				"ifNull",
				"nullIf",
				"assume",
				"empty",
				"notEmpty",
				"length",
				"lengthUTF8",
				"lower",
				"upper",
				"lowerUTF8",
				"upperUTF8",
				"reverse",
				"reverseUTF8",
				"concat",
				"substring",
				"substringUTF8",
				"appendTrailingCharIfAbsent",
				"convertCharset",
				"base64Encode",
				"base64Decode",
				"tryBase64Decode",
				"endsWith",
				"startsWith",
				"trim",
				"trimLeft",
				"trimRight",
				"trimBoth",
				"count",
				"sum",
				"min",
				"max",
				"avg",
				"any",
				"anyHeavy",
				"anyLast",
				"argMin",
				"argMax",
				"uniq",
				"uniqCombined",
				"uniqHLL12",
				"uniqExact",
				"groupArray",
				"groupUniqArray",
				"groupArrayInsertAt",
				"quantile",
				"quantileDeterministic",
				"quantileTiming",
				"quantileTimingWeighted",
				"quantileExact",
				"quantileExactWeighted",
				"quantileTDigest",
				"median",
				"quantiles",
				"varSamp",
				"varPop",
				"stddevSamp",
				"stddevPop",
				"covarSamp",
				"covarPop",
				"corr",
				"topK",
				"topKWeighted",
				"interval",
				"arrayJoin",
				"arrayMap",
				"arrayFilter",
				"arrayExists",
				"arrayAll",
				"arrayCount",
				"arraySum",
				"arrayAvg",
				"arrayConcat",
				"arraySlice",
				"arrayReverse",
				"arrayUniq",
				"arrayDistinct",
				"arrayEnumerate",
				"arrayEnumerateUniq",
				"arrayPopBack",
				"arrayPopFront",
				"arrayPushBack",
				"arrayPushFront",
				"arrayResize",
				"arrayFill",
				"dictGet",
				"dictGetOrDefault",
				"dictHas",
				"dictGetHierarchy",
				"dictIsIn",
				"dictGetString",
				"dictGetUInt8",
				"dictGetUInt16",
				"dictGetUInt32",
				"dictGetUInt64",
				"dictGetInt8",
				"dictGetInt16",
				"dictGetInt32",
				"dictGetInt64",
				"dictGetFloat32",
				"dictGetFloat64",
				"dictGetDate",
				"dictGetDateTime",
				"dictGetUUID",
				"dictGetOrNull",
				"dictGetOrDefault",
			],
			operators: [
				"+",
				"-",
				"*",
				"/",
				"%",
				"=",
				">",
				"<",
				">=",
				"<=",
				"<>",
				"!=",
				"<=>",
				"AND",
				"OR",
				"NOT",
				"LIKE",
				"IN",
				"IS",
				"BETWEEN",
				"REGEXP",
			],
			builtinFunctions: [
				"count",
				"sum",
				"min",
				"max",
				"avg",
				"any",
				"anyHeavy",
				"anyLast",
				"argMin",
				"argMax",
				"uniq",
				"uniqCombined",
				"uniqHLL12",
				"uniqExact",
				"groupArray",
				"groupUniqArray",
				"groupArrayInsertAt",
				"quantile",
				"quantileDeterministic",
				"quantileTiming",
				"quantileTimingWeighted",
				"quantileExact",
				"quantileExactWeighted",
				"quantileTDigest",
				"median",
				"quantiles",
				"varSamp",
				"varPop",
				"stddevSamp",
				"stddevPop",
				"covarSamp",
				"covarPop",
				"corr",
				"topK",
				"topKWeighted",
				"interval",
			],
			builtinVariables: [
				// ClickHouse doesn't have many built-in variables like MySQL
				"database",
				"table",
				"default_kind",
			],
			pseudoColumns: [
				// ClickHouse doesn't have pseudo-columns like Oracle
			],
			tokenizer: {
				root: [
					{ include: "@comments" },
					{ include: "@whitespace" },
					{ include: "@numbers" },
					{ include: "@strings" },
					{ include: "@complexIdentifiers" },
					{ include: "@scopes" },
					[/[;,.]/, "delimiter"],
					[/[()]/, "@brackets"],
					[
						/[\w@#$]+/,
						{
							cases: {
								"@keywords": "keyword",
								"@operators": "operator",
								"@builtinFunctions": "predefined",
								"@builtinVariables": "predefined",
								"@default": "identifier",
							},
						},
					],
					[/[<>=!%&+\-*/|~^]/, "operator"],
				],
				whitespace: [[/\s+/, "white"]],
				comments: [
					[/--+.*/, "comment"],
					[/\/\*/, { token: "comment.quote", next: "@comment" }],
				],
				comment: [
					[/[^*/]+/, "comment"],
					[/\*\//, { token: "comment.quote", next: "@pop" }],
					[/./, "comment"],
				],
				numbers: [
					[/0[xX][0-9a-fA-F]*/, "number"],
					[/[$][+-]*\d*(\.\d*)?/, "number"],
					[/((\d+(\.\d*)?)|(\.\d+))([eE][-+]?\d+)?/, "number"],
				],
				strings: [
					[/'/, { token: "string", next: "@string" }],
					[/"/, { token: "string.double", next: "@stringDouble" }],
				],
				string: [
					[/[^']+/, "string"],
					[/''/, "string"],
					[/'/, { token: "string", next: "@pop" }],
				],
				stringDouble: [
					[/[^"]+/, "string.double"],
					[/""/, "string.double"],
					[/"/, { token: "string.double", next: "@pop" }],
				],
				complexIdentifiers: [
					[/`/, { token: "identifier.quote", next: "@quotedIdentifier" }],
				],
				quotedIdentifier: [
					[/[^`]+/, "identifier"],
					[/``/, "identifier"],
					[/`/, { token: "identifier.quote", next: "@pop" }],
				],
				scopes: [
					// ClickHouse doesn't have many special scopes
				],
			},
		},
	}),
};

export default function Dashboard() {
	const [layouts, setLayouts] = useState(initialLayouts);
	const [widgets, setWidgets] = useState(initialWidgets);
	const [editingWidget, setEditingWidget] = useState<string | null>(null);
	const [isEditing, setIsEditing] = useState(false);
	const [sheetOpen, setSheetOpen] = useState(false);
	const [currentTab, setCurrentTab] = useState("general");
	const [isFullscreenEditor, setIsFullscreenEditor] = useState(false);
	const editorRef = useRef<any>(null);

	// Current widget being edited
	const currentWidget = editingWidget ? widgets[editingWidget] : null;

	// Handle layout changes
	const handleLayoutChange = (layout: any, layouts: any) => {
		setLayouts(layouts);
	};

	// Open the edit sheet for a widget
	const openEditSheet = (widgetId: string) => {
		setEditingWidget(widgetId);
		setSheetOpen(true);
		setCurrentTab("general");
	};

	// Close the edit sheet
	const closeEditSheet = () => {
		setEditingWidget(null);
		setSheetOpen(false);
		setIsFullscreenEditor(false);
	};

	// Update widget properties
	const updateWidget = (widgetId: string, updates: any) => {
		setWidgets((prev) => ({
			...prev,
			[widgetId]: {
				...prev[widgetId],
				...updates,
			},
		}));
	};

	// Update widget type-specific properties
	const updateWidgetProperties = (widgetId: string, properties: any) => {
		setWidgets((prev) => ({
			...prev,
			[widgetId]: {
				...prev[widgetId],
				properties: {
					...prev[widgetId].properties,
					...properties,
				},
			},
		}));
	};

	// Handle Monaco Editor mount
	const handleEditorDidMount = (editor: any) => {
		editorRef.current = editor;
	};

	// Update query from Monaco Editor
	const handleEditorChange = (value: string | undefined) => {
		if (editingWidget && value !== undefined) {
			updateWidget(editingWidget, { query: value });
		}
	};

	// Add a new widget
	const addNewWidget = () => {
		const newWidgetId = `widget-${
			Object.keys(widgets).length + 1
		}-${Date.now()}`;

		// Add to layouts
		setLayouts((prev) => {
			return {
				...prev,
				lg: [
					...prev.lg,
					{ i: newWidgetId, x: 0, y: Number.POSITIVE_INFINITY, w: 2, h: 2 },
				],
			};
		});

		// Add widget data
		setWidgets((prev) => {
			return {
				...prev,
				[newWidgetId]: {
					title: "New Widget",
					type: WIDGET_TYPES.STAT_CARD,
					query: "",
					description: "",
					value: "0",
					properties: {
						prefix: "",
						suffix: "",
						color: "blue",
					},
				},
			};
		});

		// Open edit sheet for the new widget
		openEditSheet(newWidgetId);
	};

	// Remove a widget
	const removeWidget = (widgetId: string) => {
		// Remove from layouts
		setLayouts((prev) => {
			return {
				...prev,
				lg: prev.lg.filter((item) => item.i !== widgetId),
			};
		});

		// Remove widget data
		setWidgets((prev) => {
			const newWidgets = { ...prev };
			delete newWidgets[widgetId];
			return newWidgets;
		});
	};

	// Toggle fullscreen editor
	const toggleFullscreenEditor = () => {
		setIsFullscreenEditor(!isFullscreenEditor);
	};

	// Format currency
	const formatCurrency = (value: number) => {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 2,
		}).format(value);
	};

	// Render widget content based on type
	const renderWidgetContent = (widget: any) => {
		switch (widget.type) {
			case WIDGET_TYPES.STAT_CARD:
				return (
					<div className="flex flex-col justify-center items-center h-full">
						<div className="text-3xl font-bold">
							{widget.properties.prefix}
							{widget.value}
							{widget.properties.suffix}
						</div>
						{widget.properties.trend && (
							<div
								className={`text-sm mt-2 ${
									widget.properties.trendDirection === "up"
										? "text-green-500"
										: "text-red-500"
								}`}
							>
								{widget.properties.trendDirection === "up" ? "↑" : "↓"}{" "}
								{widget.properties.trend}
							</div>
						)}
						<div className="text-sm text-muted-foreground mt-2">
							{widget.description}
						</div>
					</div>
				);
			case WIDGET_TYPES.BAR_CHART:
				return (
					<div className="flex flex-col h-full">
						<div className="text-sm text-muted-foreground mb-2">
							{widget.description}
						</div>
						<div className="flex-grow">
							<ResponsiveContainer width="100%" height="100%">
								<RechartsBarChart
									data={widget.data}
									margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
								>
									<CartesianGrid strokeDasharray="3 3" />
									<XAxis dataKey={widget.properties.xAxis} />
									<YAxis />
									<Tooltip
										formatter={(value) => [`${value}`, widget.properties.yAxis]}
									/>
									<Bar
										dataKey={widget.properties.yAxis}
										fill={
											CHART_COLORS[
												widget.properties.color as keyof typeof CHART_COLORS
											][0]
										}
									/>
								</RechartsBarChart>
							</ResponsiveContainer>
						</div>
					</div>
				);
			case WIDGET_TYPES.LINE_CHART:
				return (
					<div className="flex flex-col h-full">
						<div className="text-sm text-muted-foreground mb-2">
							{widget.description}
						</div>
						<div className="flex-grow">
							<ResponsiveContainer width="100%" height="100%">
								<RechartsLineChart
									data={widget.data}
									margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
								>
									<CartesianGrid strokeDasharray="3 3" />
									<XAxis dataKey={widget.properties.xAxis} />
									<YAxis />
									<Tooltip
										formatter={(value) => [`${value}`, widget.properties.yAxis]}
									/>
									<Line
										type="monotone"
										dataKey={widget.properties.yAxis}
										stroke={
											CHART_COLORS[
												widget.properties.color as keyof typeof CHART_COLORS
											][0]
										}
										activeDot={{ r: 8 }}
									/>
								</RechartsLineChart>
							</ResponsiveContainer>
						</div>
					</div>
				);
			case WIDGET_TYPES.PIE_CHART:
				return (
					<div className="flex flex-col h-full">
						<div className="text-sm text-muted-foreground mb-2">
							{widget.description}
						</div>
						<div className="flex-grow">
							<ResponsiveContainer width="100%" height="100%">
								<RechartsPieChart>
									<Pie
										data={widget.data}
										cx="50%"
										cy="50%"
										labelLine={false}
										label={({ name, percent }) =>
											`${name}: ${(percent * 100).toFixed(0)}%`
										}
										outerRadius={80}
										fill="#8884d8"
										dataKey="value"
									>
										{widget.data.map((entry: any, index: number) => (
											<Cell
												key={`cell-${index}`}
												fill={
													CHART_COLORS[
														widget.properties.color as keyof typeof CHART_COLORS
													][
														index %
															CHART_COLORS[
																widget.properties
																	.color as keyof typeof CHART_COLORS
															].length
													]
												}
											/>
										))}
									</Pie>
									<Tooltip formatter={(value) => [`${value}`, "Count"]} />
								</RechartsPieChart>
							</ResponsiveContainer>
						</div>
					</div>
				);
			case WIDGET_TYPES.TABLE:
				return (
					<div className="flex flex-col h-full">
						<div className="text-sm text-muted-foreground mb-2">
							{widget.description}
						</div>
						<div className="flex-grow overflow-auto">
							<Table>
								<TableHeader>
									{widget.data && widget.data.length > 0 && (
										<TableRow>
											{Object.keys(widget.data[0]).map((key) => (
												<TableHead key={key} className="text-xs">
													{key
														.replace(/_/g, " ")
														.replace(/\b\w/g, (l) => l.toUpperCase())}
												</TableHead>
											))}
										</TableRow>
									)}
								</TableHeader>
								<TableBody>
									{widget.data &&
										widget.data.map((row: any, rowIndex: number) => (
											<TableRow key={rowIndex}>
												{Object.entries(row).map(([key, value], cellIndex) => (
													<TableCell
														key={`${rowIndex}-${cellIndex}`}
														className="text-xs py-2"
													>
														{key === "amount"
															? formatCurrency(value as number)
															: (value as React.ReactNode)}
													</TableCell>
												))}
											</TableRow>
										))}
								</TableBody>
							</Table>
						</div>
					</div>
				);
			default:
				return <div>Unknown widget type</div>;
		}
	};

	// Get widget type icon
	const WidgetTypeIcon = ({ type }: { type: string }) => {
		const IconComponent =
			WIDGET_TYPE_ICONS[type as keyof typeof WIDGET_TYPE_ICONS];
		return <IconComponent className="h-4 w-4" />;
	};

	return (
		<div className="p-4 container mx-auto">
			<div className="flex justify-between items-center mb-6">
				<h1 className="text-2xl font-bold">Customizable Dashboard</h1>
				<div className="flex gap-2">
					<Button
						variant={isEditing ? "default" : "outline"}
						onClick={() => setIsEditing(!isEditing)}
					>
						{isEditing ? (
							<>
								<Save className="h-4 w-4 mr-2" /> Save Layout
							</>
						) : (
							<>
								<Edit className="h-4 w-4 mr-2" /> Edit Layout
							</>
						)}
					</Button>
					<Button onClick={addNewWidget}>
						<Plus className="h-4 w-4 mr-2" /> Add Widget
					</Button>
				</div>
			</div>

			<ResponsiveGridLayout
				className="layout"
				layouts={layouts}
				breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
				cols={{ lg: 4, md: 4, sm: 2, xs: 1, xxs: 1 }}
				rowHeight={150}
				onLayoutChange={handleLayoutChange}
				isDraggable={isEditing}
				isResizable={isEditing}
				margin={[16, 16]}
			>
				{layouts.lg.map((item) => {
					const widget = widgets[item.i];
					if (!widget) return null;

					return (
						<div key={item.i} className="bg-background">
							<Card className="h-full flex flex-col">
								<CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
									<div className="flex items-center gap-2">
										<WidgetTypeIcon type={widget.type} />
										<CardTitle className="text-lg">{widget.title}</CardTitle>
									</div>
									{isEditing && (
										<div
											className="flex gap-1 z-10"
											// This makes the div and its children non-draggable
											onMouseDown={(e) => {
												e.stopPropagation();
											}}
											onTouchStart={(e) => {
												e.stopPropagation();
											}}
										>
											<div
												className="cursor-pointer p-1 rounded-md hover:bg-muted"
												onClick={() => openEditSheet(item.i)}
											>
												<Edit className="h-4 w-4" />
											</div>
											<div
												className="cursor-pointer p-1 rounded-md hover:bg-muted"
												onClick={() => removeWidget(item.i)}
											>
												<Trash className="h-4 w-4" />
											</div>
										</div>
									)}
								</CardHeader>
								<CardContent className="flex-grow overflow-auto">
									{renderWidgetContent(widget)}
								</CardContent>
							</Card>
						</div>
					);
				})}
			</ResponsiveGridLayout>

			{/* Widget Edit Sheet */}
			<Sheet
				open={sheetOpen}
				onOpenChange={(open) => {
					if (!open) {
						closeEditSheet();
					} else {
						setSheetOpen(true);
					}
				}}
			>
				<SheetContent
					className={
						isFullscreenEditor
							? "w-full max-w-full h-full p-0"
							: "sm:max-w-md md:max-w-lg"
					}
				>
					<>
						<SheetHeader>
							<SheetTitle>Edit Widget</SheetTitle>
							<SheetDescription>
								Configure your widget properties and query
							</SheetDescription>
						</SheetHeader>

						{currentWidget && (
							<div className="py-4">
								<Tabs value={currentTab} onValueChange={setCurrentTab}>
									<TabsList className="grid w-full grid-cols-3">
										<TabsTrigger value="general">General</TabsTrigger>
										<TabsTrigger value="query">Query</TabsTrigger>
										<TabsTrigger value="appearance">Appearance</TabsTrigger>
									</TabsList>

									{/* General Tab */}
									<TabsContent value="general" className="space-y-4 mt-4">
										<div className="space-y-2">
											<Label htmlFor="title">Widget Title</Label>
											<Input
												id="title"
												value={currentWidget.title}
												onChange={(e) =>
													updateWidget(editingWidget!, {
														title: e.target.value,
													})
												}
											/>
										</div>

										<div className="space-y-2">
											<Label htmlFor="type">Widget Type</Label>
											<Select
												value={currentWidget.type}
												onValueChange={(value) =>
													updateWidget(editingWidget!, { type: value })
												}
											>
												<SelectTrigger>
													<SelectValue placeholder="Select widget type" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value={WIDGET_TYPES.STAT_CARD}>
														<div className="flex items-center gap-2">
															<Activity className="h-4 w-4" />
															<span>Stat Card</span>
														</div>
													</SelectItem>
													<SelectItem value={WIDGET_TYPES.BAR_CHART}>
														<div className="flex items-center gap-2">
															<BarChart3 className="h-4 w-4" />
															<span>Bar Chart</span>
														</div>
													</SelectItem>
													<SelectItem value={WIDGET_TYPES.LINE_CHART}>
														<div className="flex items-center gap-2">
															<LineChart className="h-4 w-4" />
															<span>Line Chart</span>
														</div>
													</SelectItem>
													<SelectItem value={WIDGET_TYPES.PIE_CHART}>
														<div className="flex items-center gap-2">
															<PieChart className="h-4 w-4" />
															<span>Pie Chart</span>
														</div>
													</SelectItem>
													<SelectItem value={WIDGET_TYPES.TABLE}>
														<div className="flex items-center gap-2">
															<Database className="h-4 w-4" />
															<span>Table</span>
														</div>
													</SelectItem>
												</SelectContent>
											</Select>
										</div>

										<div className="space-y-2">
											<Label htmlFor="description">Description</Label>
											<Textarea
												id="description"
												value={currentWidget.description}
												onChange={(e) =>
													updateWidget(editingWidget!, {
														description: e.target.value,
													})
												}
												placeholder="Describe what this widget shows"
											/>
										</div>

										{/* Stat Card specific fields */}
										{currentWidget.type === WIDGET_TYPES.STAT_CARD && (
											<div className="space-y-4">
												<div className="grid grid-cols-3 gap-4">
													<div className="space-y-2">
														<Label htmlFor="prefix">Prefix</Label>
														<Input
															id="prefix"
															value={currentWidget.properties.prefix}
															onChange={(e) =>
																updateWidgetProperties(editingWidget!, {
																	prefix: e.target.value,
																})
															}
															placeholder="$"
														/>
													</div>
													<div className="space-y-2">
														<Label htmlFor="value">Value</Label>
														<Input
															id="value"
															value={currentWidget.value}
															onChange={(e) =>
																updateWidget(editingWidget!, {
																	value: e.target.value,
																})
															}
															placeholder="1,234"
														/>
													</div>
													<div className="space-y-2">
														<Label htmlFor="suffix">Suffix</Label>
														<Input
															id="suffix"
															value={currentWidget.properties.suffix}
															onChange={(e) =>
																updateWidgetProperties(editingWidget!, {
																	suffix: e.target.value,
																})
															}
															placeholder="%"
														/>
													</div>
												</div>

												<div className="grid grid-cols-2 gap-4">
													<div className="space-y-2">
														<Label htmlFor="trend">Trend</Label>
														<Input
															id="trend"
															value={currentWidget.properties.trend || ""}
															onChange={(e) =>
																updateWidgetProperties(editingWidget!, {
																	trend: e.target.value,
																})
															}
															placeholder="12%"
														/>
													</div>
													<div className="space-y-2">
														<Label htmlFor="trendDirection">Direction</Label>
														<Select
															value={
																currentWidget.properties.trendDirection || "up"
															}
															onValueChange={(value) =>
																updateWidgetProperties(editingWidget!, {
																	trendDirection: value,
																})
															}
														>
															<SelectTrigger>
																<SelectValue placeholder="Select direction" />
															</SelectTrigger>
															<SelectContent>
																<SelectItem value="up">Up</SelectItem>
																<SelectItem value="down">Down</SelectItem>
															</SelectContent>
														</Select>
													</div>
												</div>
											</div>
										)}

										{/* Chart specific fields */}
										{(currentWidget.type === WIDGET_TYPES.BAR_CHART ||
											currentWidget.type === WIDGET_TYPES.LINE_CHART) && (
											<div className="grid grid-cols-2 gap-4">
												<div className="space-y-2">
													<Label htmlFor="xAxis">X Axis</Label>
													<Input
														id="xAxis"
														value={currentWidget.properties.xAxis}
														onChange={(e) =>
															updateWidgetProperties(editingWidget!, {
																xAxis: e.target.value,
															})
														}
														placeholder="date, category, etc."
													/>
												</div>
												<div className="space-y-2">
													<Label htmlFor="yAxis">Y Axis</Label>
													<Input
														id="yAxis"
														value={currentWidget.properties.yAxis}
														onChange={(e) =>
															updateWidgetProperties(editingWidget!, {
																yAxis: e.target.value,
															})
														}
														placeholder="value, count, etc."
													/>
												</div>
											</div>
										)}
									</TabsContent>

									{/* Query Tab */}
									<TabsContent value="query" className="space-y-4 mt-4">
										<div className="space-y-2">
											<div className="flex justify-between items-center">
												<Label htmlFor="query">ClickHouse Query</Label>
											</div>
											<div className="border rounded-md h-60">
												<Editor
													height="100%"
													defaultLanguage="sql"
													value={currentWidget.query}
													onChange={handleEditorChange}
													onMount={handleEditorDidMount}
													options={{
														minimap: { enabled: false },
														scrollBeyondLastLine: false,
														fontSize: 14,
														wordWrap: "on",
														automaticLayout: true,
													}}
													beforeMount={(monaco) => {
														// Register ClickHouse SQL language
														monaco.languages.register({ id: "clickhouse-sql" });
														monaco.languages.setMonarchTokensProvider(
															"clickhouse-sql",
															clickhouseLanguageConfig.loader().language
														);
														monaco.editor.defineTheme("clickhouse-dark", {
															base: "vs-dark",
															inherit: true,
															rules: [
																{
																	token: "keyword",
																	foreground: "569CD6",
																	fontStyle: "bold",
																},
																{ token: "operator", foreground: "D4D4D4" },
																{ token: "string", foreground: "CE9178" },
																{ token: "number", foreground: "B5CEA8" },
																{
																	token: "comment",
																	foreground: "6A9955",
																	fontStyle: "italic",
																},
																{ token: "predefined", foreground: "DCDCAA" },
															],
															colors: {
																"editor.background": "#1E1E1E",
															},
														});
														monaco.editor.setTheme("clickhouse-dark");
													}}
												/>
											</div>
											<p className="text-xs text-muted-foreground mt-1">
												Write your ClickHouse SQL query here. The results will
												be used to populate the widget.
											</p>
										</div>

										<div className="flex justify-between">
											<Button variant="outline" size="sm">
												Validate Query
											</Button>
											<Button size="sm">Run Query</Button>
										</div>
									</TabsContent>

									{/* Appearance Tab */}
									<TabsContent value="appearance" className="space-y-4 mt-4">
										<div className="space-y-2">
											<Label htmlFor="color">Color Theme</Label>
											<Select
												value={currentWidget.properties.color}
												onValueChange={(value) =>
													updateWidgetProperties(editingWidget!, {
														color: value,
													})
												}
											>
												<SelectTrigger>
													<SelectValue placeholder="Select color theme" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="blue">Blue</SelectItem>
													<SelectItem value="green">Green</SelectItem>
													<SelectItem value="red">Red</SelectItem>
													<SelectItem value="purple">Purple</SelectItem>
													<SelectItem value="orange">Orange</SelectItem>
												</SelectContent>
											</Select>
										</div>

										{/* Additional appearance options based on widget type */}
										{currentWidget.type === WIDGET_TYPES.STAT_CARD && (
											<div className="space-y-2">
												<Label htmlFor="textSize">Text Size</Label>
												<Select
													defaultValue="medium"
													onValueChange={(value) =>
														updateWidgetProperties(editingWidget!, {
															textSize: value,
														})
													}
												>
													<SelectTrigger>
														<SelectValue placeholder="Select text size" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="small">Small</SelectItem>
														<SelectItem value="medium">Medium</SelectItem>
														<SelectItem value="large">Large</SelectItem>
													</SelectContent>
												</Select>
											</div>
										)}

										{(currentWidget.type === WIDGET_TYPES.BAR_CHART ||
											currentWidget.type === WIDGET_TYPES.LINE_CHART ||
											currentWidget.type === WIDGET_TYPES.PIE_CHART) && (
											<div className="space-y-2">
												<Label htmlFor="showLegend">Legend</Label>
												<Select
													defaultValue="true"
													onValueChange={(value) =>
														updateWidgetProperties(editingWidget!, {
															showLegend: value === "true",
														})
													}
												>
													<SelectTrigger>
														<SelectValue placeholder="Show legend" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="true">Show</SelectItem>
														<SelectItem value="false">Hide</SelectItem>
													</SelectContent>
												</Select>
											</div>
										)}

										<div className="flex items-center space-x-2 pt-2">
											<Switch
												id="auto-refresh"
												onCheckedChange={(checked) =>
													updateWidgetProperties(editingWidget!, {
														autoRefresh: checked,
													})
												}
											/>
											<Label htmlFor="auto-refresh">Auto-refresh data</Label>
										</div>
									</TabsContent>
								</Tabs>
							</div>
						)}

						<SheetFooter className="mt-4">
							<Button variant="outline" onClick={closeEditSheet}>
								Cancel
							</Button>
							<Button onClick={closeEditSheet}>Save Changes</Button>
						</SheetFooter>
					</>
				</SheetContent>
			</Sheet>
		</div>
	);
}
