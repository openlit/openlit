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
	createdAt: string;
	updatedAt: string;
	widgets: BoardWidget[];
};

export type Folder = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	parentId: string | null;
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

export type Widget = {
	id: string;
	title: string;
	description: string;
	widgetType: string;
	properties: Record<string, any>;
	query: string;
	createdAt: string;
	updatedAt: string;
};

export type FolderHeirarchy = Folder & {
	boards: Board[];
	children: DashlitHeirarchy[];
};

export type DashlitItemType = "folder" | "board";

export interface DashlitHeirarchy {
	id: string;
	title: string;
	description: string;
	type: DashlitItemType;
	children?: DashlitHeirarchy[];
	parentId?: string | null;
}

// export type DashlitHeirarchy = (Board | FolderHeirarchy)[];
