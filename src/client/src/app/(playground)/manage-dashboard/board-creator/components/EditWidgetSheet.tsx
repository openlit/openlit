"use client";

import React from "react";
import {
	BarChartWidget,
	PieChartWidget,
	StatCardWidget,
	WidgetType,
	MarkdownWidget,
	ChartWidget,
	TableWidget,
} from "../types";
import { useEditWidget } from "../hooks/useEditWidget";
import {
	Activity,
	BarChart3,
	LineChart,
	PieChart,
	Database,
	FileText,
} from "lucide-react";
import CodeEditor from "./CodeEditor";

import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetDescription,
	SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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
import { useDashboard } from "../context/DashboardContext";
import QueryDebugger from "./QueryDebugger";

interface EditWidgetSheetProps {
	editorLanguage?: string;
}

export const EditWidgetSheet: React.FC<EditWidgetSheetProps> = ({
	editorLanguage = "clickhouse-sql",
}) => {
	const {
		currentTab,
		setCurrentTab,
		isFullscreenEditor,
		toggleFullscreenEditor,
		currentWidget,
		closeEditSheet,
		updateWidget,
		updateWidgetProperties,
		runQuery,
	} = useEditWidget();

	const { handleWidgetCrud } = useDashboard();
	const [queryResult, setQueryResult] = React.useState<any>(null);
	const [queryError, setQueryError] = React.useState<string | null>(null);
	const [isQueryLoading, setIsQueryLoading] = React.useState(false);

	// if (!currentWidget) return null;

	const handleEditorChange = (value: string | undefined) => {
		if (value !== undefined) {
			updateWidget(currentWidget!.id, { config: { query: value } });
		}
	};

	const handleRunQuery = async () => {
		if (currentWidget?.config?.query) {
			setIsQueryLoading(true);
			setQueryError(null);
			try {
				const result = await runQuery(currentWidget.id, {
					userQuery: currentWidget.config.query,
				});
				setQueryResult(result.data);
				setQueryError(result.err);
			} catch (error) {
				setQueryError(
					error instanceof Error
						? error.message
						: "An error occurred while running the query"
				);
			} finally {
				setIsQueryLoading(false);
			}
		}
	};

	const handleSave = async () => {
		if (currentWidget && handleWidgetCrud) {
			try {
				await handleWidgetCrud(currentWidget);
				closeEditSheet();
			} catch (error) {
				console.error("Failed to save widget:", error);
			}
		} else {
			closeEditSheet();
		}
	};

	return (
		<Sheet
			open={!!currentWidget}
			onOpenChange={(open) => {
				if (!open) {
					closeEditSheet();
				}
			}}
		>
			<SheetContent
				className={
					isFullscreenEditor
						? "w-full max-w-full h-full p-0"
						: "sm:max-w-md md:max-w-lg flex flex-col h-full"
				}
			>
				<div className="flex flex-col h-full">
					<SheetHeader>
						<SheetTitle>Edit Widget</SheetTitle>
						<SheetDescription>
							Configure your widget properties and query
						</SheetDescription>
					</SheetHeader>

					{currentWidget && (
						<div className="flex-1 overflow-y-auto py-4">
							<Tabs value={currentTab} onValueChange={setCurrentTab}>
								<TabsList className="grid w-full grid-cols-3">
									<TabsTrigger value="general">General</TabsTrigger>
									<TabsTrigger value="query">Config</TabsTrigger>
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
												updateWidget(currentWidget.id, {
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
												updateWidget(currentWidget.id, {
													type: value as WidgetType,
												})
											}
										>
											<SelectTrigger>
												<SelectValue placeholder="Select widget type" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value={WidgetType.STAT_CARD}>
													<div className="flex items-center gap-2">
														<Activity className="h-4 w-4" />
														<span>Stat Card</span>
													</div>
												</SelectItem>
												<SelectItem value={WidgetType.BAR_CHART}>
													<div className="flex items-center gap-2">
														<BarChart3 className="h-4 w-4" />
														<span>Bar Chart</span>
													</div>
												</SelectItem>
												<SelectItem value={WidgetType.LINE_CHART}>
													<div className="flex items-center gap-2">
														<LineChart className="h-4 w-4" />
														<span>Line Chart</span>
													</div>
												</SelectItem>
												<SelectItem value={WidgetType.AREA_CHART}>
													<div className="flex items-center gap-2">
														<BarChart3 className="h-4 w-4" />
														<span>Area Chart</span>
													</div>
												</SelectItem>
												<SelectItem value={WidgetType.PIE_CHART}>
													<div className="flex items-center gap-2">
														<PieChart className="h-4 w-4" />
														<span>Pie Chart</span>
													</div>
												</SelectItem>
												<SelectItem value={WidgetType.TABLE}>
													<div className="flex items-center gap-2">
														<Database className="h-4 w-4" />
														<span>Table</span>
													</div>
												</SelectItem>
												<SelectItem value={WidgetType.MARKDOWN}>
													<div className="flex items-center gap-2">
														<FileText className="h-4 w-4" />
														<span>Markdown</span>
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
												updateWidget(currentWidget.id, {
													description: e.target.value,
												})
											}
											placeholder="Describe what this widget shows"
										/>
									</div>

									{/* Stat Card specific fields */}
									{currentWidget.type === WidgetType.STAT_CARD && (
										<div className="space-y-4">
											<div className="grid grid-cols-3 gap-4">
												<div className="space-y-2">
													<Label htmlFor="prefix">Prefix</Label>
													<Input
														id="prefix"
														value={
															(currentWidget as StatCardWidget).properties
																.prefix
														}
														onChange={(e) =>
															updateWidgetProperties(currentWidget.id, {
																prefix: e.target.value,
															})
														}
														placeholder="$"
													/>
												</div>
												<div className="space-y-2">
													<Label htmlFor="value">Value Path</Label>
													<Input
														id="value"
														value={
															(currentWidget as StatCardWidget).properties.value
														}
														onChange={(e) =>
															updateWidget(currentWidget.id, {
																properties: {
																	...currentWidget.properties,
																	value: e.target.value,
																},
															})
														}
														placeholder="1,234"
													/>
												</div>
												<div className="space-y-2">
													<Label htmlFor="suffix">Suffix</Label>
													<Input
														id="suffix"
														value={
															(currentWidget as StatCardWidget).properties
																.suffix
														}
														onChange={(e) =>
															updateWidgetProperties(currentWidget.id, {
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
														value={
															(currentWidget as StatCardWidget).properties.trend
														}
														onChange={(e) =>
															updateWidgetProperties(currentWidget.id, {
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
															(currentWidget as StatCardWidget).properties
																.trendDirection || "up"
														}
														onValueChange={(value) =>
															updateWidgetProperties(currentWidget.id, {
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
									{(currentWidget.type === WidgetType.BAR_CHART ||
										currentWidget.type === WidgetType.LINE_CHART ||
										currentWidget.type === WidgetType.AREA_CHART) && (
										<div className="grid grid-cols-2 gap-4">
											<div className="space-y-2">
												<Label htmlFor="xAxis">X Axis</Label>
												<Input
													id="xAxis"
													value={
														(currentWidget as BarChartWidget).properties.xAxis
													}
													onChange={(e) =>
														updateWidgetProperties(currentWidget.id, {
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
													value={
														(currentWidget as BarChartWidget).properties.yAxis
													}
													onChange={(e) =>
														updateWidgetProperties(currentWidget.id, {
															yAxis: e.target.value,
														})
													}
													placeholder="value, count, etc."
												/>
											</div>
										</div>
									)}

									{currentWidget.type === WidgetType.PIE_CHART && (
										<div className="space-y-4">
											<div className="grid grid-cols-3 gap-4">
												<div className="space-y-2">
													<Label htmlFor="labelPath">Label Path</Label>
													<Input
														id="labelPath"
														value={
															(currentWidget as PieChartWidget).properties
																.labelPath
														}
														onChange={(e) =>
															updateWidgetProperties(currentWidget.id, {
																labelPath: e.target.value,
															})
														}
														placeholder="$"
													/>
												</div>
												<div className="space-y-2">
													<Label htmlFor="value">Value Path</Label>
													<Input
														id="value"
														value={
															(currentWidget as PieChartWidget).properties
																.valuePath
														}
														onChange={(e) =>
															updateWidget(
																(currentWidget as PieChartWidget).id,
																{
																	properties: {
																		...(currentWidget as PieChartWidget)
																			.properties,
																		valuePath: e.target.value,
																	},
																}
															)
														}
														placeholder="1,234"
													/>
												</div>
											</div>
										</div>
									)}
								</TabsContent>

								{/* Config Tab */}
								<TabsContent value="query" className="space-y-4 mt-4">
									{currentWidget.type === WidgetType.MARKDOWN ? (
										<div className="space-y-4">
											<div className="space-y-2">
												<Label htmlFor="content">Markdown Content</Label>
												<Textarea
													id="content"
													value={
														(currentWidget as MarkdownWidget).config?.content
													}
													onChange={(e) =>
														updateWidget(currentWidget.id, {
															config: {
																...(currentWidget as MarkdownWidget).config,
																content: e.target.value,
															},
														})
													}
													placeholder="Write your markdown content here..."
													className="min-h-[400px] font-mono"
												/>
											</div>
										</div>
									) : (
										<>
											<div className="space-y-2">
												<div className="flex justify-between items-center">
													<Label htmlFor="query">Query</Label>
												</div>
												<div className="border rounded-md h-[calc(100vh-400px)]">
													<CodeEditor
														value={currentWidget.config?.query || ""}
														onChange={handleEditorChange}
														language={editorLanguage}
													/>
												</div>
											</div>

											<div className="flex justify-end">
												<Button size="sm" onClick={handleRunQuery}>
													Run Query
												</Button>
											</div>

											<div className="">
												<QueryDebugger
													data={queryResult}
													error={queryError || undefined}
													isLoading={isQueryLoading}
												/>
											</div>
										</>
									)}
								</TabsContent>

								{/* Appearance Tab */}
								<TabsContent value="appearance" className="space-y-4 mt-4">
									{currentWidget.type !== WidgetType.MARKDOWN && (
										<>
											{(currentWidget.type === WidgetType.STAT_CARD ||
												currentWidget.type === WidgetType.BAR_CHART ||
												currentWidget.type === WidgetType.LINE_CHART ||
												currentWidget.type === WidgetType.PIE_CHART ||
												currentWidget.type === WidgetType.AREA_CHART ||
												currentWidget.type === WidgetType.TABLE) && (
												<div className="space-y-2">
													<Label htmlFor="color">Color Theme</Label>
													<Select
														value={(currentWidget as ChartWidget | StatCardWidget | TableWidget).properties.color}
														onValueChange={(value) =>
															updateWidgetProperties(currentWidget.id, {
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
											)}

											{/* Additional appearance options based on widget type */}
											{currentWidget.type === WidgetType.STAT_CARD && (
												<div className="space-y-2">
													<Label htmlFor="textSize">Text Size</Label>
													<Select
														defaultValue="medium"
														onValueChange={(value) =>
															updateWidgetProperties(currentWidget.id, {
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

											{(currentWidget.type === WidgetType.BAR_CHART ||
												currentWidget.type === WidgetType.LINE_CHART ||
												currentWidget.type === WidgetType.PIE_CHART ||
												currentWidget.type === WidgetType.AREA_CHART) && (
												<div className="space-y-2">
													<Label htmlFor="showLegend">Legend</Label>
													<Select
														defaultValue="true"
														onValueChange={(value) =>
															updateWidgetProperties(currentWidget.id, {
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
														updateWidgetProperties(currentWidget.id, {
															autoRefresh: checked,
														})
													}
												/>
												<Label htmlFor="auto-refresh">Auto-refresh data</Label>
											</div>
										</>
									)}
									{currentWidget.type === WidgetType.MARKDOWN && (
										<div className="flex items-center justify-center h-[200px] text-muted-foreground">
											Appearance configuration is not available for Markdown widgets
										</div>
									)}
								</TabsContent>
							</Tabs>
						</div>
					)}

					<SheetFooter className="flex-shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-4 px-6">
						<div className="flex justify-between w-full">
							<Button
								variant="outline"
								onClick={closeEditSheet}
								className="px-8"
							>
								Cancel
							</Button>
							<Button
								onClick={handleSave}
								className="px-8 bg-primary hover:bg-primary/90"
							>
								Save Changes
							</Button>
						</div>
					</SheetFooter>
				</div>
			</SheetContent>
		</Sheet>
	);
};

export default EditWidgetSheet;
