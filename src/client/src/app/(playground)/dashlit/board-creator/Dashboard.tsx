"use client";

import React from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Edit, Save, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DashboardProps, Widget } from "./types";
import { DashboardProvider, useDashboard } from "./context/DashboardContext";
import WidgetRenderer from "./widgets/WidgetRenderer";
import EditWidgetSheet from "./components/EditWidgetSheet";
import { useEditWidget } from "./hooks/useEditWidget";
import {
	Dialog,
	DialogTrigger,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
	DialogClose,
} from "@/components/ui/dialog";

// Responsive grid layout with automatic width calculation
const ResponsiveGridLayout = WidthProvider(Responsive);

const WidgetSelectionModal: React.FC<{
	open: boolean;
	onClose: () => void;
	widgets: Widget[];
	onSelect: (widget: Widget) => void;
	onCreateNew: () => void;
}> = ({ open, onClose, widgets, onSelect, onCreateNew }) => (
	<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
		<DialogContent>
			<DialogHeader>
				<DialogTitle>Select a Widget</DialogTitle>
				<DialogDescription>
					Choose an existing widget to add, or create a new one.
				</DialogDescription>
			</DialogHeader>
			<div className="max-h-64 overflow-y-auto my-4">
				{widgets.length === 0 ? (
					<div className="text-center text-stone-500">No widgets found.</div>
				) : (
					<ul className="space-y-2">
						{widgets.map((w) => (
							<li key={w.id}>
								<Button
									variant="outline"
									className="w-full justify-start"
									onClick={() => onSelect(w)}
								>
									<span className="font-semibold mr-2">{w.title}</span>
									<span className="text-xs text-stone-500">({w.type})</span>
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>
			<DialogFooter>
				<Button onClick={onCreateNew} variant="default">
					+ Create New Widget
				</Button>
				<DialogClose asChild>
					<Button variant="ghost">Cancel</Button>
				</DialogClose>
			</DialogFooter>
		</DialogContent>
	</Dialog>
);

const DashboardContent: React.FC<Omit<DashboardProps, "initialConfig">> = ({
	onSave,
	readonly = false,
	className,
	editorLanguage = "clickhouse-sql",
	breakpoints = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 },
	cols = { lg: 4, md: 4, sm: 2, xs: 1, xxs: 1 },
	rowHeight = 150,
}) => {
	const {
		title,
		layouts,
		setLayouts,
		widgets,
		isEditing,
		setIsEditing,
		getDashboardConfig,
		addWidget,
		fetchExistingWidgets,
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
		<div className={`p-4 container mx-auto ${className}`}>
			<div className="flex justify-between items-center mb-6">
				<h1 className="text-2xl font-bold">{title}</h1>

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
			>
				{layouts.lg.map((item: any) => {
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
								}}
							/>
						</div>
					);
				})}
			</ResponsiveGridLayout>

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
