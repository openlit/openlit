import { DatabaseWidget, Widget } from "@/types/manage-dashboard";
import { dataCollector, MetricParams, OTEL_TRACES_TABLE_NAME } from "../common";
import { OPENLIT_WIDGET_TABLE_NAME } from "./table-details";
import Sanitizer from "@/utils/sanitizer";
import getMessage from "@/constants/messages";
import {
	normalizeWidgetToClient,
	normalizeWidgetToServer,
	sanitizeWidget,
} from "@/helpers/server/widget";
import mustache from "mustache";

import { getFilterWhereCondition } from "@/helpers/server/platform";
export async function getWidgetById(id: string) {
	const query = `
		SELECT id, title, description, widget_type AS type, created_at AS createdAt, updated_at AS updatedAt
		FROM ${OPENLIT_WIDGET_TABLE_NAME} 
		WHERE id = '${Sanitizer.sanitizeValue(id)}'
	`;

	const { data, err } = await dataCollector({ query });

	if (err) {
		return { err: getMessage().WIDGET_FETCH_FAILED };
	}

	return { data: normalizeWidgetToClient(data as DatabaseWidget) };
}

export async function getWidgets(widgetIds?: string[]) {
	const query = `
		SELECT id, title, description, widget_type AS type, properties,
			config, created_at AS createdAt, updated_at AS updatedAt
		FROM ${OPENLIT_WIDGET_TABLE_NAME}
		${widgetIds
			? `WHERE id IN (${widgetIds
				.map((id) => `'${Sanitizer.sanitizeValue(id)}'`)
				.join(",")})`
			: ""
		}
	`;

	const { data, err } = await dataCollector({ query });

	if (err) {
		return { err: getMessage().WIDGET_FETCH_FAILED };
	}

	return { data: (data as Array<DatabaseWidget>).map(normalizeWidgetToClient) };
}

export async function createWidget(widget: Widget) {
	const sanitizedWidget = sanitizeWidget(widget);

	const { err, data } = await dataCollector(
		{
			table: OPENLIT_WIDGET_TABLE_NAME,
			values: [
				{
					id: sanitizedWidget.id,
					title: sanitizedWidget.title,
					description: sanitizedWidget.description,
					widget_type: sanitizedWidget.type,
					properties: JSON.stringify(sanitizedWidget.properties || {}),
					config: JSON.stringify(sanitizedWidget.config || {}),
				},
			],
		},
		"insert"
	);

	if (err) {
		return { err: getMessage().WIDGET_UPDATE_FAILED };
	}

	// Extract the ID from the response
	const queryId = (data as { query_id: string })?.query_id;

	// Get the created widget to return its ID
	if (queryId) {
		const result = await dataCollector({
			query: `SELECT id, title, description, widget_type AS type, created_at AS createdAt, properties,
			config, updated_at AS updatedAt FROM ${OPENLIT_WIDGET_TABLE_NAME} ORDER BY created_at DESC LIMIT 1`,
		});

		if (
			!result.err &&
			result.data &&
			Array.isArray(result.data) &&
			result.data.length > 0
		) {
			return {
				data: {
					...normalizeWidgetToClient(result.data[0] as DatabaseWidget),
				},
			};
		}
	}

	return { err: getMessage().WIDGET_CREATE_FAILED };
}

export async function updateWidget(widget: Widget) {
	const sanitizedWidget = sanitizeWidget(widget);

	const updateValues = [
		sanitizedWidget.title && `title = '${sanitizedWidget.title}'`,
		sanitizedWidget.description &&
		`description = '${sanitizedWidget.description}'`,
		sanitizedWidget.type && `widget_type = '${sanitizedWidget.type}'`,
		sanitizedWidget.properties &&
		`properties = '${JSON.stringify(sanitizedWidget.properties)}'`,
		sanitizedWidget.config &&
		`config = '${JSON.stringify(sanitizedWidget.config)}'`,
	];

	const query = `
		ALTER TABLE ${OPENLIT_WIDGET_TABLE_NAME}
		UPDATE 
			${updateValues.filter((e) => e).join(" , ")}
		WHERE id = '${sanitizedWidget.id}'
	`;

	const { err, data } = await dataCollector({ query }, "exec");
	console.log(widget.properties , sanitizedWidget.properties, query, err, data);

	if (err || !(data as { query_id: string }).query_id)
		return { err: getMessage().WIDGET_UPDATE_FAILED };

	return { data: getMessage().WIDGET_UPDATED_SUCCESSFULLY };
}

export function deleteWidget(id: string) {
	const query = `
		DELETE FROM ${OPENLIT_WIDGET_TABLE_NAME} 
		WHERE id = '${Sanitizer.sanitizeValue(id)}'
	`;

	return dataCollector({ query }, "exec");
}

export async function runWidgetQuery(
	widgetId: string,
	{
		userQuery,
		respectFilters,
		filter,
	}: {
		userQuery?: string;
		respectFilters: boolean;
		filter: MetricParams;
	}
) {
	const { data: widgetData, err: widgetErr } = await getWidgetById(widgetId);

	if (widgetErr) {
		return { err: getMessage().WIDGET_FETCH_FAILED };
	}

	const widget = ((widgetData || []) as DatabaseWidget[])[0];

	const query = userQuery
		? userQuery
		: normalizeWidgetToClient(widget).config?.query || "";

	const filteredQuery = `
		SELECT 
			*
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition({
		...filter,
	})}
	`;

	// TODO: Check for the select query only
	let exactQuery = `${query.replace(
		respectFilters ? /FROM\s+otel_traces/i : "",
		respectFilters ? `FROM ( ${filteredQuery} )` : ""
	)}`;

	exactQuery = mustache.render(exactQuery, { filter });

	const { data, err } = await dataCollector({ query: exactQuery });

	if (err) {
		return { err: err || getMessage().WIDGET_RUN_FAILED };
	}

	return { data };
}
