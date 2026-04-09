import { getCurrentUser } from "@/lib/session";
import { createWidget } from "@/lib/platform/manage-dashboard/widget";
import { dataCollector } from "@/lib/platform/common";
import { OPENLIT_BOARD_WIDGET_TABLE_NAME } from "@/lib/platform/manage-dashboard/table-details";
import Sanitizer from "@/utils/sanitizer";
import { NextRequest } from "next/server";
import crypto from "crypto";

export async function POST(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const body = await request.json();
	const { title, description, type, query, properties, boardId } = body;

	if (!title || !type || !query) {
		return Response.json("Missing required fields: title, type, query", {
			status: 400,
		});
	}

	// Convert the query to use Mustache templates for dashboard time filters
	const templatedQuery = convertToMustacheTemplate(query);

	const now = new Date().toISOString();
	const widgetId = crypto.randomUUID();
	const widget = {
		id: widgetId,
		title,
		description: description || "",
		type,
		properties: properties || {},
		config: {
			query: templatedQuery,
		},
		createdAt: now,
		updatedAt: now,
	};

	const { data: widgetData, err: widgetErr } = await createWidget(widget);

	if (widgetErr) {
		return Response.json({ err: widgetErr }, { status: 400 });
	}

	// If a boardId is provided, add the widget to the board
	if (boardId) {
		const createdWidgetId =
			(widgetData as any)?.id || widgetId;

		const position = JSON.stringify({ x: 0, y: Infinity, w: 4, h: 6 });

		const { err: linkErr } = await dataCollector(
			{
				table: OPENLIT_BOARD_WIDGET_TABLE_NAME,
				values: [
					{
						board_id: Sanitizer.sanitizeValue(boardId),
						widget_id: Sanitizer.sanitizeValue(createdWidgetId),
						position,
					},
				],
			},
			"insert"
		);

		if (linkErr) {
			// Widget was created but linking failed — return partial success
			return Response.json({
				data: widgetData,
				warning: "Widget created but could not be added to the dashboard.",
			});
		}
	}

	return Response.json({ data: widgetData });
}

/**
 * Convert a chat-generated SQL query into a Mustache-templated query
 * that works with dashboard time filters.
 *
 * The standard dashboard pattern uses:
 *   WITH
 *     parseDateTimeBestEffort('{{filter.timeLimit.start}}') AS start_time,
 *     parseDateTimeBestEffort('{{filter.timeLimit.end}}') AS end_time
 *
 * This function replaces hardcoded time references with Mustache variables.
 */
function convertToMustacheTemplate(query: string): string {
	let result = query;

	// 1. Replace existing CTE parseDateTimeBestEffort with template variables
	//    e.g. parseDateTimeBestEffort('2025-01-01 00:00:00') AS start_time
	result = result.replace(
		/parseDateTimeBestEffort\s*\(\s*'[^']+'\s*\)\s*(AS\s+start_time)/gi,
		"parseDateTimeBestEffort('{{filter.timeLimit.start}}') $1"
	);
	result = result.replace(
		/parseDateTimeBestEffort\s*\(\s*'[^']+'\s*\)\s*(AS\s+end_time)/gi,
		"parseDateTimeBestEffort('{{filter.timeLimit.end}}') $1"
	);

	// 2. Replace now() - INTERVAL patterns in WHERE clauses
	//    e.g. WHERE Timestamp >= now() - INTERVAL 24 HOUR
	result = result.replace(
		/Timestamp\s*>=\s*now\(\)\s*-\s*INTERVAL\s+\d+\s+\w+/gi,
		"Timestamp >= parseDateTimeBestEffort('{{filter.timeLimit.start}}')"
	);
	result = result.replace(
		/Timestamp\s*<=\s*now\(\)/gi,
		"Timestamp <= parseDateTimeBestEffort('{{filter.timeLimit.end}}')"
	);

	// 3. Replace toStartOfDay(now()) / toStartOfHour(now()) patterns
	result = result.replace(
		/Timestamp\s*>=\s*toStartOf\w+\(now\(\)\)/gi,
		"Timestamp >= parseDateTimeBestEffort('{{filter.timeLimit.start}}')"
	);

	// 4. If query has no time template yet but references Timestamp with hardcoded dates,
	//    replace them
	//    e.g. Timestamp >= '2025-04-07 00:00:00'
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
