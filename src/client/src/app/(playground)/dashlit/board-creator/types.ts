import type { ReactNode } from "react";
import type { Layouts } from "react-grid-layout";

// Widget Types
export enum WidgetType {
	STAT_CARD = "STAT_CARD",
	BAR_CHART = "BAR_CHART",
	LINE_CHART = "LINE_CHART",
	PIE_CHART = "PIE_CHART",
	TABLE = "TABLE",
	AREA_CHART = "AREA_CHART",
}

// Color Themes
export type ColorTheme = "blue" | "green" | "red" | "purple" | "orange";

// Base Widget Interface
export interface BaseWidgetProps {
	id: string;
	title: string;
	type: WidgetType;
	description?: string;
	config?: Record<string, any>;
	properties: Record<string, any>;
}

// Specific Widget Interfaces
export interface StatCardWidget extends BaseWidgetProps {
	type: WidgetType.STAT_CARD;
	properties: {
		prefix?: string;
		suffix?: string;
		value?: string;
		color?: ColorTheme;
		trend?: string;
		trendDirection?: "up" | "down";
		textSize?: "small" | "medium" | "large";
		autoRefresh?: boolean;
	};
}

export interface ChartWidget extends BaseWidgetProps {
	properties: {
		color: ColorTheme;
		showLegend?: boolean;
		autoRefresh?: boolean;
	};
}

export interface BarChartWidget extends ChartWidget {
	type: WidgetType.BAR_CHART;
	properties: ChartWidget["properties"] & {
		xAxis: string;
		yAxis: string;
	};
}

export interface LineChartWidget extends ChartWidget {
	type: WidgetType.LINE_CHART;
	properties: ChartWidget["properties"] & {
		xAxis: string;
		yAxis: string;
	};
}

export interface PieChartWidget extends ChartWidget {
	type: WidgetType.PIE_CHART;
	properties: ChartWidget["properties"] & {
		labelPath: string;
		valuePath: string;
	};
}

export interface TableWidget extends BaseWidgetProps {
	type: WidgetType.TABLE;
	properties: {
		color: ColorTheme;
		autoRefresh?: boolean;
	};
}

export interface AreaChartWidget extends ChartWidget {
	type: WidgetType.AREA_CHART;
	properties: ChartWidget["properties"] & {
		xAxis: string;
		yAxis: string;
	};
}

// Combined Widget Type
export type Widget =
	| StatCardWidget
	| BarChartWidget
	| LineChartWidget
	| PieChartWidget
	| TableWidget
	| AreaChartWidget;

// Widgets Record - maps widget IDs to widget objects
export type WidgetsRecord = Record<string, Widget>;

// Dashboard Configuration
export interface DashboardConfig {
	title: string;
	description: string;
	layouts: Layouts;
	widgets: WidgetsRecord;
}

// Dashboard Props
export interface DashboardProps {
	initialConfig?: DashboardConfig;
	onSave?: (config: DashboardConfig) => void;
	readonly?: boolean;
	className?: string;
	renderCustomWidget?: (widget: Widget) => ReactNode;
	editorLanguage?: string;
	customTheme?: any;
	breakpoints?: { [key: string]: number };
	cols?: { [key: string]: number };
	rowHeight?: number;
	runQuery?: (
		widgetId: string,
		params: { userQuery: string }
	) => Promise<{ data: any; err: string | null }>;
	handleWidgetCrud?: (updates: Partial<Widget>) => Promise<Widget>;
	fetchExistingWidgets?: () => Promise<Widget[]>;
}

// Widget Renderer Props
export interface WidgetRendererProps {
	widget: Widget;
	isEditing: boolean;
	onEdit: (widgetId: string) => void;
	onRemove: (widgetId: string) => void;
}

// Editor Props
export interface EditorProps {
	value: string;
	onChange: (value: string | undefined) => void;
	language?: string;
	height?: string;
	fullScreen?: boolean;
}
