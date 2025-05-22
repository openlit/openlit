import { DatabaseWidget, Widget } from "@/types/manage-dashboard";
import { jsonParse } from "@/utils/json";
import Sanitizer from "@/utils/sanitizer";

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

export function sanitizeWidget(widget: Widget) {
	const sanitizedWidget = Sanitizer.sanitizeObject(widget);

	if (sanitizedWidget.config?.query) {
		sanitizedWidget.config.query = sanitizedWidget.config.query.replace(
			/\\'/g,
			"''"
		);
	}

	return sanitizedWidget;
}
