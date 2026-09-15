export type GridPosition = {
	x: number;
	y: number;
	w: number;
	h: number;
};

export type Board = {
	id: string;
	title: string;
	description: string;
	parentId: string | null;
	isMainDashboard: boolean;
	isPinned: boolean;
	createdAt: string;
	updatedAt: string;
	widgets: BoardWidget[];
	totalWidgets?: number;
	tags: string;
};

export type Folder = {
	id: string;
	title: string;
	description: string;
	createdAt: string;
	updatedAt: string;
	parentId: string | null;
	tags: string;
};

export type BoardWidget = {
	id: string;
	boardId: string;
	widgetId: string;
	createdAt: string;
	updatedAt: string;
	position: GridPosition;
	widget: Widget;
};

/** Execution mode for a structured (non-SQL) widget query. */
export type WidgetStructuredMode = "list" | "aggregate" | "timeseries";

/**
 * Optional per-widget telemetry source reference (Grafana-style per-panel
 * datasource). When `sourceId` is set, the widget queries that source (must
 * belong to the current project / environment). When omitted, the widget
 * follows the project's per-signal binding. Raw `config.query` SQL runs only
 * on the built-in ClickHouse source; external sources must provide
 * `structuredQuery`. Use `builtin:<databaseConfigId>` to pin ClickHouse.
 */
export interface WidgetSourceConfig {
	/** Raw ClickHouse SQL (built-in source only). */
	query?: string;
	/** Explicit TelemetrySource id override, or `builtin:<dbConfigId>`. */
	sourceId?: string | null;
	/** Signal used for signal-aware routing and structured dispatch. */
	signal?: "traces" | "logs" | "metrics";
	/** Structured query for external (non-SQL) sources. */
	structuredQuery?: {
		mode?: WidgetStructuredMode;
		/** A vendor-agnostic OpenLITQuery (timeRange is injected at run time). */
		query: Record<string, any>;
		/** UI-only filter rows; incomplete drafts never enter the executable query. */
		draftFilters?: Array<Record<string, unknown>>;
	};
	[key: string]: any;
}

export interface Widget {
	id: string;
	title: string;
	description: string;
	type: string;
	properties: Record<string, any>;
	config: WidgetSourceConfig & Record<string, any>;
	createdAt: string;
	updatedAt: string;
	totalBoards?: number;
}

export interface DatabaseWidget {
	properties: string;
	config: string;
}

export type FolderHeirarchy = Folder & {
	boards: Board[];
	children: DashboardHeirarchy[];
	type: "folder";
};

export type BoardHeirarchy = Board & {
	type: "board";
};

export type DashboardItemType = "folder" | "board";

export interface DashboardHeirarchy {
	id: string;
	title: string;
	description: string;
	isMainDashboard?: boolean;
	isPinned?: boolean;
	tags: string;
	type: DashboardItemType;
	children?: DashboardHeirarchy[];
	parentId?: string | null;
}
