"use client";

import React from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Edit, Save, Plus, LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DashboardProps, Widget, WidgetType } from "./types";
import { DashboardProvider, useDashboard } from "./context/dashboard-context";
import WidgetRenderer from "./widgets/widget-renderer";
import dynamic from "next/dynamic";
import createMessage from "@/constants/messages";
const EditWidgetSheet = dynamic(() => import("./components/edit-widget-sheet"));
const WidgetSelectionModal = dynamic(
	() => import("./components/widget-selection-modal")
);

import { useEditWidget } from "./hooks/useEditWidget";

import DescriptionTooltip from "./components/description-tooltip";

// Empty state component
const EmptyState = ({ onAddWidget }: { onAddWidget: () => void }) => (
	<div className="flex flex-col items-center justify-center h-[70vh] text-center px-4">
		<div className="w-full max-w-md space-y-6">
			<div className="p-6 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
				<div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
					<Plus className="h-6 w-6 text-primary" />
				</div>
				<h3 className="text-lg font-semibold mb-2 text-stone-900 dark:text-stone-300">{createMessage().NO_WIDGETS_YET}</h3>
				<p className="text-sm text-stone-500 dark:text-stone-400 mb-4">
					{createMessage().NO_WIDGETS_YET_DESCRIPTION}
				</p>
				<Button onClick={onAddWidget} className="gap-2">
					<Plus className="h-4 w-4" /> {createMessage().NO_WIDGETS_YET_ACTION_BUTTON}
				</Button>
			</div>
		</div>
	</div>
);

const ActionButtons = ({ onClick, label, icon }: { onClick: () => void, label: string, icon: LucideIcon }) => {
	const Icon = icon;
	return (
		<Button variant="secondary" onClick={onClick} className="flex gap-2 h-auto border-none py-1.5 bg-stone-200 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300">
			<Icon className="h-3 w-3" />
			<span className="text-sm">{label}</span>
		</Button>
	);
};

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
	headerComponent,
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

	const handleCreateNew = (widgetType: WidgetType) => {
		setShowWidgetModal(false);
		addWidget({
			type: widgetType,
		});
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
			{(renderTitle || !readonly || headerComponent) && (
				<div className="flex items-center mb-6">
					{renderTitle && (
						<div className="flex items-center gap-2 text-stone-900 dark:text-stone-300">
							<h1 className="text-2xl font-bold">{title}</h1>
							{description && (
								<DescriptionTooltip description={description} className="ml-2 h-4 w-4" />
							)}
						</div>
					)}
					{headerComponent}
					<div className="flex-1" />
					{!readonly && (
						<div className="flex gap-2">
							<ActionButtons
								onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
								icon={isEditing ? Save : Edit}
								label={isEditing ? "Save Layout" : "Edit Layout"}
							/>
							{isEditing && (
								<ActionButtons
									onClick={handleAddWidget}
									icon={Plus}
									label={"Add Widget"}
								/>
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
