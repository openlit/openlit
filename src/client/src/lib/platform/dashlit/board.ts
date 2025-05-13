import { Board, Widget } from "@/types/dashlit";
import { dataCollector } from "../common";
import {
	OPENLIT_BOARD_TABLE_NAME,
	OPENLIT_BOARD_WIDGET_TABLE_NAME,
	OPENLIT_WIDGET_TABLE_NAME,
} from "./table-details";
import getMessage from "@/constants/messages";
import Sanitizer from "@/utils/sanitizer";
import { getWidgets } from "./widget";
import { pluck } from "lodash/fp";

export function getBoardById(id: string) {
	const query = `
		SELECT *
		FROM ${OPENLIT_BOARD_TABLE_NAME} 
		WHERE id = '${Sanitizer.sanitizeValue(id)}'
	`;

	return dataCollector({ query });
}

export function getBoards() {
	const query = `
		SELECT id, title, description, parent_id AS parentId, is_main_dashboard AS isMainDashboard, created_at AS createdAt, updated_at AS updatedAt
		FROM ${OPENLIT_BOARD_TABLE_NAME} 
	`;

	return dataCollector({ query });
}

export function createBoard(board: Board) {
	const sanitizedBoard = Sanitizer.sanitizeObject(board);

	return dataCollector(
		{
			table: OPENLIT_BOARD_TABLE_NAME,
			values: [
				{
					title: sanitizedBoard.title,
					description: sanitizedBoard.description,
					parent_id: sanitizedBoard.parentId,
					is_main_dashboard: sanitizedBoard.isMainDashboard,
				},
			],
		},
		"insert"
	);
}

export async function updateBoard(board: Board) {
	const sanitizedBoard = Sanitizer.sanitizeObject(board);

	const updateValues = [
		sanitizedBoard.title && `title = '${sanitizedBoard.title}'`,
		sanitizedBoard.description &&
			`description = '${sanitizedBoard.description}'`,
		`parent_id = '${sanitizedBoard.parentId}'`,
	];

	const query = `
		ALTER TABLE ${OPENLIT_BOARD_TABLE_NAME}
		UPDATE 
			${updateValues.filter((e) => e).join(" , ")}
		WHERE id = '${sanitizedBoard.id}'
	`;

	const { err, data } = await dataCollector({ query }, "exec");

	if (err || !(data as { query_id: string }).query_id)
		return { err: getMessage().BOARD_UPDATE_FAILED };

	return { data: getMessage().BOARD_UPDATED_SUCCESSFULLY };
}

export function deleteBoard(id: string) {
	const query = `
		DELETE FROM ${OPENLIT_BOARD_TABLE_NAME} 
		WHERE id = '${Sanitizer.sanitizeValue(id)}'
	`;

	return dataCollector({ query }, "exec");
}

export async function getBoardLayout(id: string) {
	// First get the board details
	const boardQuery = `
		SELECT 
			id AS boardId,
			title AS boardTitle,
			description AS boardDescription,
			is_main_dashboard AS isMainDashboard,
			created_at AS boardCreatedAt,
			updated_at AS boardUpdatedAt
		FROM ${OPENLIT_BOARD_TABLE_NAME}
		WHERE id = '${Sanitizer.sanitizeValue(id)}'
	`;

	const { data: boardData, err: boardErr } = await dataCollector({
		query: boardQuery,
	});
	const boardResult = (boardData as any[])?.[0] as {
		boardId: string;
		boardTitle: string;
		boardDescription: string;
		isMainDashboard: boolean;
		boardCreatedAt: string;
		boardUpdatedAt: string;
	};

	if (!boardResult || boardErr)
		return { err: getMessage().BOARD_DATA_NOT_FOUND };

	// Then get the widget mappings with positions
	const widgetMappingsQuery = `
		SELECT 
			bw.id AS boardWidgetId,
			bw.widget_id AS widgetId,
			bw.position,
			bw.created_at AS boardWidgetCreatedAt,
			bw.updated_at AS boardWidgetUpdatedAt
		FROM ${OPENLIT_BOARD_WIDGET_TABLE_NAME} bw
		WHERE bw.board_id = '${Sanitizer.sanitizeValue(id)}'
	`;

	const { data: mappingsData, err: mappingsErr } = await dataCollector({
		query: widgetMappingsQuery,
	});
	const mappingsResult = (mappingsData || []) as Array<{
		boardWidgetId: string;
		widgetId: string;
		position: string;
		boardWidgetCreatedAt: string;
		boardWidgetUpdatedAt: string;
	}>;

	// Finally get the widget details
	const widgetIds = pluck("widgetId", mappingsResult);

	let widgetsResult: Array<Widget> = [];

	if (widgetIds) {
		const { data: widgetsData } = await getWidgets(widgetIds);
		widgetsResult = (widgetsData || []) as typeof widgetsResult;
	}

	// Create a map of widget details for easy lookup
	const widgetDetailsMap = new Map(widgetsResult.map((w) => [w.id, w]));

	// Construct the board object
	const board: Board = {
		id: boardResult.boardId,
		title: boardResult.boardTitle,
		description: boardResult.boardDescription,
		parentId: null,
		isMainDashboard: boardResult.isMainDashboard,
		createdAt: boardResult.boardCreatedAt,
		updatedAt: boardResult.boardUpdatedAt,
		widgets: [],
	};

	// Construct the layout config format
	type LayoutItem = {
		i: string;
		x: number;
		y: number;
		w: number;
		h: number;
	};

	type LayoutConfig = {
		layouts: {
			lg: LayoutItem[];
		};
		widgets: {
			[key: string]: Widget;
		};
	};

	const layoutConfig: LayoutConfig = {
		layouts: { lg: [] },
		widgets: {},
	};

	// Map widgets and create layout config
	board.widgets = mappingsResult.map((mapping) => {
		const widgetDetails = widgetDetailsMap.get(mapping.widgetId);
		const position = JSON.parse(mapping.position || "{}");

		// Add to layouts
		layoutConfig.layouts.lg.push({
			i: mapping.widgetId,
			x: position.x,
			y: position.y,
			w: position.w,
			h: position.h,
		});

		// Add to widgets map
		const widgetData = {
			id: mapping.widgetId,
			title: widgetDetails?.title || "",
			description: widgetDetails?.description || "",
			type: widgetDetails?.type || "",
			properties: widgetDetails?.properties || {},
			config: widgetDetails?.config || {},
			createdAt: widgetDetails?.createdAt || "",
			updatedAt: widgetDetails?.updatedAt || "",
		} as const;

		layoutConfig.widgets[mapping.widgetId] = widgetData;

		// Return the board widget mapping
		return {
			id: mapping.boardWidgetId,
			boardId: board.id,
			widgetId: mapping.widgetId,
			position: position || {},
			createdAt: mapping.boardWidgetCreatedAt,
			updatedAt: mapping.boardWidgetUpdatedAt,
			widget: widgetData,
		};
	});

	return {
		data: {
			...board,
			...layoutConfig,
		},
	};
}

export async function updateBoardLayout(boardId: string, layoutConfig: any) {
	// First, get all existing widget mappings for this board
	const getExistingWidgetsQuery = `
			SELECT widget_id, id
			FROM ${OPENLIT_BOARD_WIDGET_TABLE_NAME}
			WHERE board_id = '${Sanitizer.sanitizeValue(boardId)}'
		`;

	const { data: existingWidgetsData } = await dataCollector({
		query: getExistingWidgetsQuery,
	});
	const existingWidgets =
		(existingWidgetsData as { widget_id: string; id: string }[]) || [];

	// Create a map of existing widget IDs for quick lookup
	const existingWidgetMap = new Map();
	existingWidgets.forEach((widget) => {
		existingWidgetMap.set(widget.widget_id, widget.id);
	});

	console.log("existingWidgets", existingWidgets);
	console.log("existingWidgetMap", existingWidgetMap);

	// Create a set of widget IDs from the new layout config
	const newWidgetIds = new Set();
	layoutConfig.layouts.lg.forEach((layout) => {
		const widget = layoutConfig.widgets[layout.i];
		if (widget && widget.id) {
			newWidgetIds.add(widget.id);
		}
	});

	console.log("newWidgetIds", newWidgetIds);

	// Delete widgets that are no longer in the layout
	for (const existingWidget of existingWidgets) {
		if (!newWidgetIds.has(existingWidget.widget_id)) {
			const deleteQuery = `
					DELETE FROM ${OPENLIT_BOARD_WIDGET_TABLE_NAME}
					WHERE id = '${Sanitizer.sanitizeValue(existingWidget.id)}'
					AND board_id = '${Sanitizer.sanitizeValue(boardId)}'
				`;
			await dataCollector({ query: deleteQuery }, "exec");
		}
	}

	// Update or insert widget mappings
	for (const layout of layoutConfig.layouts.lg) {
		const widget = layoutConfig.widgets[layout.i];
		if (widget && widget.id) {
			const position = {
				x: layout.x,
				y: layout.y,
				w: layout.w,
				h: layout.h,
			};

			if (existingWidgetMap.has(widget.id)) {
				// Update existing widget mapping
				const updateQuery = `
						ALTER TABLE ${OPENLIT_BOARD_WIDGET_TABLE_NAME}
						UPDATE 
							position = '${JSON.stringify(position)}',
							updated_at = now()
						WHERE id = '${Sanitizer.sanitizeValue(existingWidgetMap.get(widget.id))}'
					`;

				await dataCollector({ query: updateQuery }, "exec");
			} else {
				// Insert new widget mapping
				await dataCollector(
					{
						table: OPENLIT_BOARD_WIDGET_TABLE_NAME,
						values: [
							{
								board_id: Sanitizer.sanitizeValue(boardId),
								widget_id: Sanitizer.sanitizeValue(widget.id),
								position: JSON.stringify(position),
							},
						],
					},
					"insert"
				);
			}
		}
	}

	return { data: getMessage().BOARD_LAYOUT_UPDATED_SUCCESSFULLY };
}
