import { createWidget } from "@/lib/platform/manage-dashboard/widget";
import { dataCollector } from "@/lib/platform/common";
import { OPENLIT_BOARD_WIDGET_TABLE_NAME } from "@/lib/platform/manage-dashboard/table-details";
import Sanitizer from "@/utils/sanitizer";
import crypto from "crypto";

export interface SaveWidgetInput {
	title: string;
	description?: string;
	type: string;
	query: string;
	properties?: Record<string, any>;
	boardId?: string;
}

/**
 * Convert hardcoded time references in SQL to Mustache template variables
 * for dashboard time filter compatibility.
 */
export function convertToMustacheTemplate(query: string): string {
	let result = query;

	result = result.replace(
		/parseDateTimeBestEffort\s*\(\s*'[^']+'\s*\)\s*(AS\s+start_time)/gi,
		"parseDateTimeBestEffort('{{filter.timeLimit.start}}') $1"
	);
	result = result.replace(
		/parseDateTimeBestEffort\s*\(\s*'[^']+'\s*\)\s*(AS\s+end_time)/gi,
		"parseDateTimeBestEffort('{{filter.timeLimit.end}}') $1"
	);
	result = result.replace(
		/Timestamp\s*>=\s*now\(\)\s*-\s*INTERVAL\s+\d+\s+\w+/gi,
		"Timestamp >= parseDateTimeBestEffort('{{filter.timeLimit.start}}')"
	);
	result = result.replace(
		/Timestamp\s*<=\s*now\(\)/gi,
		"Timestamp <= parseDateTimeBestEffort('{{filter.timeLimit.end}}')"
	);
	result = result.replace(
		/Timestamp\s*>=\s*toStartOf\w+\(now\(\)\)/gi,
		"Timestamp >= parseDateTimeBestEffort('{{filter.timeLimit.start}}')"
	);
	result = result.replace(
		/Timestamp\s*>=\s*'\d{4}-\d{2}-\d{2}[^']*'/gi,
		"Timestamp >= parseDateTimeBestEffort('{{filter.timeLimit.start}}')"
	);
	result = result.replace(
		/Timestamp\s*<=\s*'\d{4}-\d{2}-\d{2}[^']*'/gi,
		"Timestamp <= parseDateTimeBestEffort('{{filter.timeLimit.end}}')"
	);

	return result;
}

/**
 * Save a chat query as a dashboard widget, optionally adding it to a board.
 */
export async function saveQueryAsWidget(input: SaveWidgetInput) {
	const templatedQuery = convertToMustacheTemplate(input.query);

	const now = new Date().toISOString();
	const widgetId = crypto.randomUUID();

	const widget = {
		id: widgetId,
		title: input.title,
		description: input.description || "",
		type: input.type,
		properties: input.properties || {},
		config: { query: templatedQuery },
		createdAt: now,
		updatedAt: now,
	};

	const { data: widgetData, err: widgetErr } = await createWidget(widget);

	if (widgetErr) {
		return { err: widgetErr };
	}

	// Link widget to board if boardId provided
	if (input.boardId) {
		const createdWidgetId = (widgetData as any)?.id || widgetId;
		const position = JSON.stringify({ x: 0, y: Infinity, w: 4, h: 6 });

		const { err: linkErr } = await dataCollector(
			{
				table: OPENLIT_BOARD_WIDGET_TABLE_NAME,
				values: [
					{
						board_id: Sanitizer.sanitizeValue(input.boardId),
						widget_id: Sanitizer.sanitizeValue(createdWidgetId),
						position,
					},
				],
			},
			"insert"
		);

		if (linkErr) {
			return {
				data: widgetData,
				warning: "Widget created but could not be added to the dashboard.",
			};
		}
	}

	return { data: widgetData };
}
