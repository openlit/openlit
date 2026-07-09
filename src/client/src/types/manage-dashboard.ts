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
 * datasource). When `sourceId`/`signal` are omitted the widget resolves to the
 * project's default routing (built-in ClickHouse in CE). Raw `config.query`
 * SQL runs only on the built-in ClickHouse source; external sources must
 * provide `structuredQuery`.
 */
export interface WidgetSourceConfig {
	/** Raw ClickHouse SQL (built-in source only). */
	query?: string;
	/** Explicit TelemetrySource id override. */
	sourceId?: string | null;
	/** Signal used for signal-aware routing and structured dispatch. */
	signal?: "traces" | "logs" | "metrics";
	/** Structured query for external (non-SQL) sources. */
	structuredQuery?: {
		mode?: WidgetStructuredMode;
		/** A vendor-agnostic OpenLITQuery (timeRange is injected at run time). */
		query: Record<string, any>;
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
