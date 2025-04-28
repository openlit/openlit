import { DatabaseWidget, Widget } from "@/types/dashlit";
import { jsonParse } from "@/utils/json";

export function normalizeWidgetToClient(widget: DatabaseWidget) {
	return {
		...widget,
		properties: jsonParse(widget.properties || "{}") || {},
		config: jsonParse(widget.config || "{}") || {},
	};
}

export function normalizeWidgetToServer(widget: Widget) {
	return {
		...widget,
		properties: widget.properties ? JSON.stringify(widget.properties) : null,
		config: widget.config ? JSON.stringify(widget.config) : null,
	};
}
