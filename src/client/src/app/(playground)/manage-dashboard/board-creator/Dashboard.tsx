"use client";

import React from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Edit, Save, Plus, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DashboardProps, Widget } from "./types";
import { DashboardProvider, useDashboard } from "./context/DashboardContext";
import WidgetRenderer from "./widgets/WidgetRenderer";
import dynamic from "next/dynamic";

// Empty state component
const EmptyState = ({ onAddWidget }: { onAddWidget: () => void }) => (
	<div className="flex flex-col items-center justify-center h-[70vh] text-center px-4">
		<div className="w-full max-w-md space-y-6">
			<div className="p-6 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
				<div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
					<Plus className="h-6 w-6 text-primary" />
				</div>
				<h3 className="text-lg font-semibold mb-2">No widgets yet</h3>
				<p className="text-sm text-muted-foreground mb-4">
					Create your first widget to start building your custom dashboard. Add charts, stats, and more to visualize your data.
				</p>
				<Button onClick={onAddWidget} className="gap-2">
					<Plus className="h-4 w-4" /> Add Your First Widget
				</Button>
			</div>
		</div>
	</div>
);

const EditWidgetSheet = dynamic(() => import("./components/EditWidgetSheet"));
const WidgetSelectionModal = dynamic(
	() => import("./components/WidgetSelectionModal")
);

import { useEditWidget } from "./hooks/useEditWidget";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

// Responsive grid layout with automatic width calculation
const ResponsiveGridLayout = WidthProvider(Responsive);

const DashboardContent: React.FC<Omit<DashboardProps, "initialConfig">> = ({
	onSave,
	readonly = false,
	className,
	editorLanguage = "clickhouse-sql",
	breakpoints = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 },
	cols = { lg: 4, md: 4, sm: 2, xs: 1, xxs: 1 },
	rowHeight = 150,
	renderTitle = true,
	runFilters,
}) => {
	const {
		title,
		description,
		layouts,
		setLayouts,
		widgets,
		isEditing,
		setIsEditing,
		getDashboardConfig,
		addWidget,
		fetchExistingWidgets,
		removeWidget,
	} = useDashboard();

	const { openEditSheet } = useEditWidget();

	// Modal state
	const [showWidgetModal, setShowWidgetModal] = React.useState(false);
	const [existingWidgets, setExistingWidgets] = React.useState<Widget[]>([]);

	// Wrap addWidget to handle modal logic
	const handleAddWidget = async () => {
		if (fetchExistingWidgets) {
			const widgets = await fetchExistingWidgets();
			setExistingWidgets(widgets);
			setShowWidgetModal(true);
		} else {
			addWidget();
		}
	};

	const handleSelectWidget = (widget: Widget) => {
		setShowWidgetModal(false);
		addWidget(widget);
	};

	const handleCreateNew = () => {
		setShowWidgetModal(false);
		addWidget();
	};

	// Handle layout changes
	const handleLayoutChange = (layout: any, layouts: any) => {
		setLayouts(layouts);
	};

	// Handle save
	const handleSave = () => {
		if (onSave) {
			onSave(getDashboardConfig());
		}
		setIsEditing(false);
	};

	return (
		<div className={`w-full ${className ?? ""}`}>
			{(renderTitle || !readonly) && (
				<div className="flex justify-between items-center mb-6">
					{renderTitle && (
						<div className="flex items-center gap-2">
							<h1 className="text-2xl font-bold">{title}</h1>
							{description && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Info className="h-3 w-3" />
									</TooltipTrigger>
									<TooltipContent>{description}</TooltipContent>
								</Tooltip>
							)}
						</div>
					)}

					{!readonly && (
						<div className="flex gap-2">
							<Button
								variant={isEditing ? "default" : "outline"}
								onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
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
							{isEditing && (
								<Button onClick={handleAddWidget}>
									<Plus className="h-4 w-4 mr-2" /> Add Widget
								</Button>
							)}
						</div>
					)}
				</div>
			)}

			<ResponsiveGridLayout
				className="layout"
				layouts={layouts}
				breakpoints={breakpoints}
				cols={cols}
				rowHeight={rowHeight}
				onLayoutChange={handleLayoutChange}
				isDraggable={isEditing && !readonly}
				isResizable={isEditing && !readonly}
				margin={[16, 16]}
				containerPadding={[0, 0]}
			>
				{
					layouts.lg.map((item: any) => {
						const widget = widgets[item.i];
						if (!widget) return null;

						return (
							<div key={item.i} className="bg-background">
								<WidgetRenderer
									widget={widget}
									isEditing={isEditing && !readonly}
									onEdit={openEditSheet}
									onRemove={(widgetId) => {
										// Implementation of removeWidget is in the DashboardContext
										removeWidget(widgetId);
									}}
									runFilters={runFilters}
								/>
							</div>
						);
					})
				}
			</ResponsiveGridLayout>
			{
				layouts.lg.length === 0 && (
					<div style={{ width: '100%' }}>
						<EmptyState onAddWidget={() => { setIsEditing(true); handleAddWidget() }} />
					</div>
				)
			}

			<EditWidgetSheet editorLanguage={editorLanguage} />

			<WidgetSelectionModal
				open={showWidgetModal}
				onClose={() => setShowWidgetModal(false)}
				widgets={existingWidgets}
				onSelect={handleSelectWidget}
				onCreateNew={handleCreateNew}
			/>
		</div>
	);
};

// Main Dashboard component with provider
const Dashboard: React.FC<DashboardProps> = ({ initialConfig, ...props }) => {
	return (
		<DashboardProvider
			initialConfig={initialConfig}
			onSave={props.onSave}
			runQuery={props.runQuery}
			handleWidgetCrud={props.handleWidgetCrud}
			fetchExistingWidgets={props.fetchExistingWidgets}
		>
			<DashboardContent {...props} />
		</DashboardProvider>
	);
};

export default Dashboard;
