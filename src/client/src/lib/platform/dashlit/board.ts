import { Board } from "@/types/dashlit";
import { dataCollector } from "../common";
import {
	OPENLIT_BOARD_TABLE_NAME,
	OPENLIT_BOARD_WIDGET_TABLE_NAME,
	OPENLIT_WIDGET_TABLE_NAME,
} from "./table-details";
import getMessage from "@/constants/messages";

export function getBoardById(id: string) {
	const query = `
		SELECT
			*
		FROM ${OPENLIT_BOARD_TABLE_NAME} 
		WHERE id = '${id}'
	`;

	return dataCollector({ query });
}

export function getBoards() {
	const query = `
		SELECT
			*
		FROM ${OPENLIT_BOARD_TABLE_NAME} 
	`;

	return dataCollector({ query });
}

export function createBoard(board: Board) {
	const query = `
		INSERT INTO ${OPENLIT_BOARD_TABLE_NAME} (title, description)
		VALUES (${board.title}, ${board.description})
	`;

	return dataCollector({ query });
}

export function updateBoard(board: Board) {
	const query = `
		UPDATE ${OPENLIT_BOARD_TABLE_NAME} 
		SET title = ${board.title}, description = ${board.description}
		WHERE id = ${board.id}
	`;

	return dataCollector({ query });
}

export function deleteBoard(id: string) {
	const query = `
		DELETE FROM ${OPENLIT_BOARD_TABLE_NAME} 
		WHERE id = ${id}
	`;

	return dataCollector({ query });
}

export async function getBoardLayout(id: string) {
	const query = `
    SELECT 
      b.id AS board_id, b.title AS board_title, b.description AS board_description, 
      b.folder_id, b.is_main_dashboard, b.created_at AS board_created_at, b.updated_at AS board_updated_at, 
      bw.id AS board_widget_id, bw.position, 
      w.id AS widget_id, w.title AS widget_title, w.description AS widget_description, 
      w.widget_type, w.properties, w.query, w.created_at AS widget_created_at, w.updated_at AS widget_updated_at
    FROM ${OPENLIT_BOARD_TABLE_NAME} b
    LEFT JOIN ${OPENLIT_BOARD_WIDGET_TABLE_NAME} bw ON b.id = bw.board_id
    LEFT JOIN ${OPENLIT_WIDGET_TABLE_NAME} w ON bw.widget_id = w.id
    WHERE b.id = '${id}'`;

	const { data, err } = await dataCollector({ query });
	const result = data as any[];

	if (!result.length || err) return { err: getMessage().BOARD_DATA_NOT_FOUND };
	const board: Board = {
		id: result[0].board_id,
		title: result[0].board_title,
		description: result[0].board_description,
		folder_id: result[0].folder_id,
		is_main_dashboard: result[0].is_main_dashboard,
		created_at: result[0].board_created_at,
		updated_at: result[0].board_updated_at,
		widgets: [],
	};

	// Map widgets
	board.widgets = result.map((row) => ({
		id: row.board_widget_id,
		board_id: board.id,
		widget_id: row.widget_id,
    position: row.position,
		created_at: row.board_widget_created_at,
		updated_at: row.board_widget_updated_at,
		widget: {
			id: row.widget_id,
			title: row.widget_title,
			description: row.widget_description,
			widget_type: row.widget_type,
			properties: row.properties,
			query: row.query,
			created_at: row.widget_created_at,
			updated_at: row.widget_updated_at,
		},
	}));

	return { data: board };
}

