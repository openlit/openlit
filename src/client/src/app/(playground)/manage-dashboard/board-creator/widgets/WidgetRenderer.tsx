import React, { useMemo, memo, useEffect } from "react";
import { Edit, Info, Trash } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetType, type WidgetRendererProps } from "../types";
import { WIDGET_TYPE_ICONS } from "../constants";
import StatCardWidget from "./StatCardWidget";
import BarChartWidget from "./BarChartWidget";
import LineChartWidget from "./LineChartWidget";
import PieChartWidget from "./PieChartWidget";
import TableWidget from "./TableWidget";
import AreaChartWidget from "./AreaChartWidget";
import { useDashboard } from "../context/DashboardContext";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

const WidgetRenderer: React.FC<WidgetRendererProps> = ({
	widget,
	isEditing,
	onEdit,
	onRemove,
	runFilters,
}) => {
	const { widgetData, loadWidgetData } = useDashboard();

	// Load data when not in edit mode
	useEffect(() => {
		if (!isEditing && widget.config?.query) {
			loadWidgetData(widget.id);
		}
	}, [isEditing, runFilters]);

	// Get widget type icon
	const WidgetTypeIcon = () => {
		const IconComponent =
			WIDGET_TYPE_ICONS[widget.type as keyof typeof WIDGET_TYPE_ICONS];
		return <IconComponent className="h-4 w-4" />;
	};

	const widgetEvaluatedData = widgetData[widget.id];

	const WidgetComponent = useMemo(() => {
		switch (widget.type) {
			case WidgetType.STAT_CARD:
				return StatCardWidget;
			case WidgetType.BAR_CHART:
				return BarChartWidget;
			case WidgetType.LINE_CHART:
				return LineChartWidget;
			case WidgetType.PIE_CHART:
				return PieChartWidget;
			case WidgetType.TABLE:
				return TableWidget;
			case WidgetType.AREA_CHART:
				return AreaChartWidget;
			default:
				return null;
		}
	}, [widget]);

	return (
		<Card className="h-full flex flex-col" data-widget-id={widget.id}>
			<CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
				<div className="flex items-center gap-2">
					<WidgetTypeIcon />
					<CardTitle className="text-lg">{widget.title}</CardTitle>
					{widget.description && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Info className="h-3 w-3" />
							</TooltipTrigger>
							<TooltipContent>{widget.description}</TooltipContent>
						</Tooltip>
					)}
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
							onClick={() => onEdit(widget.id)}
						>
							<Edit className="h-4 w-4" />
						</div>
						<div
							className="cursor-pointer p-1 rounded-md hover:bg-muted"
							onClick={() => onRemove(widget.id)}
						>
							<Trash className="h-4 w-4" />
						</div>
					</div>
				)}
			</CardHeader>
			<CardContent className="flex-grow overflow-auto">
				{WidgetComponent && (
					<WidgetComponent data={widgetEvaluatedData} widget={widget as any} />
				)}
			</CardContent>
		</Card>
	);
};

export default memo(WidgetRenderer);
