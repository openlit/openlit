import { Widget } from "@/types/dashlit";
import { dataCollector } from "../common";
import { OPENLIT_WIDGET_TABLE_NAME } from "./table-details";

export function getWidgetById(id: string) {
	const query = `
		SELECT * FROM ${OPENLIT_WIDGET_TABLE_NAME} WHERE id = '${id}'
`;

	return dataCollector({ query });
}

export function getWidgets() {
	const query = `
		SELECT * FROM ${OPENLIT_WIDGET_TABLE_NAME}
`;

	return dataCollector({ query });
}

export function createWidget(widget: Widget) {
	const query = `
		INSERT INTO ${OPENLIT_WIDGET_TABLE_NAME} (id, title, description, created_at, updated_at)
		VALUES (${widget.id}, ${widget.title}, ${widget.description}, ${widget.created_at}, ${widget.updated_at})
`;

	return dataCollector({ query });
}

export function updateWidget(widget: Widget) {
	const query = `
		UPDATE ${OPENLIT_WIDGET_TABLE_NAME} SET title = ${widget.title}, description = ${widget.description}, updated_at = ${widget.updated_at} WHERE id = ${widget.id}
`;

	return dataCollector({ query });
}

export function deleteWidget(id: string) {
	const query = `
		DELETE FROM ${OPENLIT_WIDGET_TABLE_NAME} WHERE id = ${id}
`;

	return dataCollector({ query });
}
