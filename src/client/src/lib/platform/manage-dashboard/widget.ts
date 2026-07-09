import { DatabaseWidget, Widget } from "@/types/manage-dashboard";
import { dataCollector, MetricParams } from "../common";
import { OPENLIT_BOARD_WIDGET_TABLE_NAME, OPENLIT_WIDGET_TABLE_NAME } from "./table-details";
import Sanitizer from "@/utils/sanitizer";
import getMessage from "@/constants/messages";
import {
	normalizeWidgetToClient,
	sanitizeWidget,
	escapeSingleQuotes,
} from "@/helpers/server/widget";
import mustache from "mustache";

import { jsonStringify } from "@/utils/json";
// NOTE: `@/lib/telemetry-source` is imported lazily inside `runWidgetQuery`
// (see below). `widget.ts` sits in a pre-existing common <-> board <-> widget
// import cycle; importing telemetry-source eagerly here would pull the
// datasource adapter graph (-> clickhouse/adapter -> @/lib/platform/common and
// -> observability) into that cycle's scope-hoisting group and reintroduce a
// "Cannot access X before initialization" TDZ in production builds.
import type {
	DataSourceAdapter,
	OpenLITQuery,
	Signal,
} from "@/lib/platform/datasource/types";
import { UnsupportedCapabilityError } from "@/lib/platform/datasource/types";
import { clampQueryBudget } from "@/lib/platform/datasource/http/limits";

export async function getWidgetById(id: string) {
	const query = `
		SELECT id, title, description, widget_type AS type, created_at AS createdAt, updated_at AS updatedAt, properties,
			config
		FROM ${OPENLIT_WIDGET_TABLE_NAME} 
		WHERE id = '${Sanitizer.sanitizeValue(id)}'
	`;

	const { data, err } = await dataCollector({ query });

	if (err) {
		return { err: err.toString() || getMessage().WIDGET_FETCH_FAILED };
	}

	return { data: normalizeWidgetToClient((data as DatabaseWidget[])[0]) };
}

export async function getWidgets(widgetIds?: string[]) {
	let query = "";
	if (!widgetIds || widgetIds.length === 0) {
		query = `
			SELECT w.id, w.title, w.description, w.widget_type AS type, w.properties,
			w.config, w.created_at AS createdAt, w.updated_at AS updatedAt, COUNT(DISTINCT bw.board_id) as totalBoards
		FROM ${OPENLIT_WIDGET_TABLE_NAME} w
		LEFT JOIN ${OPENLIT_BOARD_WIDGET_TABLE_NAME} bw ON w.id = bw.widget_id
		GROUP BY w.id, w.title, w.description, w.widget_type, w.properties, w.config, w.created_at, w.updated_at
		ORDER BY w.updated_at DESC
		`;
	} else {
		query = `
			SELECT w.id, w.title, w.description, w.widget_type AS type, w.properties,
			w.config, w.created_at AS createdAt, w.updated_at AS updatedAt
		FROM ${OPENLIT_WIDGET_TABLE_NAME} w
		${widgetIds
				? `WHERE id IN (${widgetIds
					.map((id) => `'${Sanitizer.sanitizeValue(id)}'`)
					.join(",")})`
				: ""
			}
		`;
	}

	const { data, err } = await dataCollector({ query });

	if (err) {
		return { err: err.toString() || getMessage().WIDGET_FETCH_FAILED };
	}

	return { data: (data as Array<DatabaseWidget>).map(normalizeWidgetToClient) };
}

export async function createWidget(widget: Widget, databaseConfigId?: string) {
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
		"insert",
		databaseConfigId
	);

	if (err) {
		return { err: err || getMessage().WIDGET_CREATE_FAILED };
	}

	// Look up the widget we just inserted by id (we generated the id
	// client-side and supplied it). The previous implementation
	// searched by `ORDER BY created_at DESC LIMIT 1`, which raced
	// during dashboard seeding (multiple widgets inserted in the same
	// second-precision tick) and could return the wrong row.
	if (sanitizedWidget.id) {
		const result = await dataCollector({
			query: `SELECT id, title, description, widget_type AS type, created_at AS createdAt, properties,
			config, updated_at AS updatedAt FROM ${OPENLIT_WIDGET_TABLE_NAME}
			WHERE id = '${sanitizedWidget.id}' LIMIT 1`,
		}, "query", databaseConfigId);

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

	// Insert succeeded (we already checked `err`) but the readback
	// returned empty — most likely ClickHouse async commit hasn't
	// surfaced the row yet, or this code path is running before a
	// db-config is bound (e.g. seed at server startup). Either way,
	// the widget IS in the table; return the normalized widget we
	// just inserted so the caller can move on. Skipping the
	// readback failure makes seeding deterministic.
	return {
		data: normalizeWidgetToClient({
			id: sanitizedWidget.id as string,
			title: sanitizedWidget.title || "",
			description: sanitizedWidget.description || "",
			widget_type: sanitizedWidget.type || "",
			properties: JSON.stringify(sanitizedWidget.properties || {}),
			config: JSON.stringify(sanitizedWidget.config || {}),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		} as DatabaseWidget),
	};
}

export async function updateWidget(widget: Widget) {
	const sanitizedWidget = sanitizeWidget(widget);

	const updateValues = [
		sanitizedWidget.title && `title = '${sanitizedWidget.title}'`,
		sanitizedWidget.description &&
		`description = '${sanitizedWidget.description}'`,
		sanitizedWidget.type && `widget_type = '${sanitizedWidget.type}'`,
		sanitizedWidget.properties &&
		`properties = '${jsonStringify(sanitizedWidget.properties)}'`,
		sanitizedWidget.config &&
		`config = '${escapeSingleQuotes(jsonStringify(sanitizedWidget.config))}'`,
		`updated_at = NOW()`,
	];

	const query = `
		ALTER TABLE ${OPENLIT_WIDGET_TABLE_NAME}
		UPDATE 
			${updateValues.filter((e) => e).join(" , ")}
		WHERE id = '${sanitizedWidget.id}'
	`;

	const { err, data } = await dataCollector({ query }, "exec");

	if (err || !(data as { query_id: string }).query_id) {
		return { err: err || getMessage().WIDGET_UPDATE_FAILED };
	}

	return { data: getMessage().WIDGET_UPDATED_SUCCESSFULLY };
}

export function deleteWidget(id: string) {
	const query = `
		DELETE FROM ${OPENLIT_WIDGET_TABLE_NAME} 
		WHERE id = '${Sanitizer.sanitizeValue(id)}'
	`;

	return dataCollector({ query }, "exec");
}

function validateQuery(query: string): { valid: boolean; error?: string } {
	const trimmed = query.trim();

	if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
		return { valid: false, error: "Only SELECT queries are allowed" };
	}

	return validateSafeQueryContent(trimmed);
}

function validateSafeQueryContent(value: string): { valid: boolean; error?: string } {
	if (/\bsystem\./i.test(value)) {
		return { valid: false, error: "Access to system tables is not allowed" };
	}

	if (/\binformation_schema\./i.test(value)) {
		return {
			valid: false,
			error: "Access to information_schema tables is not allowed",
		};
	}

	const dangerousFunctions =
		/\b(url|file|remote|mysql|jdbc|s3|hdfs|input|numbers_mt|generateRandom|clusterAllReplicas)\s*\(/i;
	if (dangerousFunctions.test(value)) {
		return { valid: false, error: "Query contains disallowed functions" };
	}

	const dangerousKeywords =
		/\b(DROP|ALTER|TRUNCATE|INSERT|UPDATE|DELETE|CREATE|GRANT|REVOKE|INTO\s+OUTFILE|ATTACH|DETACH|RENAME|OPTIMIZE|SYSTEM)\b/i;
	if (dangerousKeywords.test(value)) {
		return { valid: false, error: "Query contains disallowed operations" };
	}

	return { valid: true };
}

function validateFilterValues(value: unknown): { valid: boolean; error?: string } {
	if (typeof value === "string") {
		return validateSafeQueryContent(value);
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const validation = validateFilterValues(item);
			if (!validation.valid) return validation;
		}
	}

	if (value && typeof value === "object") {
		for (const item of Object.values(value)) {
			const validation = validateFilterValues(item);
			if (!validation.valid) return validation;
		}
	}

	return { valid: true };
}

/** Run raw ClickHouse SQL for a widget (built-in source path). */
async function runRawClickHouseWidgetQuery(
	query: string,
	filter: MetricParams,
	dbConfigId?: string
) {
	const filterValidation = validateFilterValues(filter);
	if (!filterValidation.valid) {
		return { err: filterValidation.error || "Invalid filter" };
	}

	const exactQuery = mustache.render(query, { filter });

	const validation = validateQuery(exactQuery);
	if (!validation.valid) {
		return { err: validation.error || "Invalid query" };
	}

	const { data, err } = await dataCollector(
		{ query: exactQuery, enable_readonly: true },
		"query",
		dbConfigId
	);

	if (err) {
		return { err: "Query execution failed" };
	}

	return { data };
}

/** Build an OpenLITQuery time range from the dashboard filter's time limit. */
function timeRangeFromFilter(filter: MetricParams): { start: Date; end: Date } {
	const limit = (filter as { timeLimit?: { start?: unknown; end?: unknown } })
		?.timeLimit;
	const end = limit?.end ? new Date(limit.end as string) : new Date();
	const start = limit?.start
		? new Date(limit.start as string)
		: new Date(end.getTime() - 24 * 60 * 60 * 1000);
	return { start, end };
}

/**
 * Execute a structured widget query against an external adapter, dispatching by
 * signal + mode. Returns the DataFrame rows in the flat array shape the widget
 * renderers already consume.
 */
async function executeStructuredWidgetQuery(
	adapter: DataSourceAdapter,
	structured: NonNullable<Widget["config"]["structuredQuery"]>,
	filter: MetricParams
) {
	const base = (structured.query || {}) as Partial<OpenLITQuery>;
	const signal = (base.signal || "traces") as Signal;
	const rawQuery: OpenLITQuery = {
		...base,
		signal,
		timeRange: timeRangeFromFilter(filter),
	} as OpenLITQuery;
	// Enforce per-query budgets so a widget can never ask a vendor for an
	// unbounded scan (max rows + max time range).
	const { query } = clampQueryBudget(rawQuery);

	const mode = structured.mode || "timeseries";
	try {
		if (signal === "logs") {
			const frame =
				mode === "list"
					? await adapter.listLogs(query)
					: await adapter.logTimeSeries(query);
			return { data: frame.rows };
		}
		if (signal === "metrics") {
			const frame = await adapter.metricTimeSeries(query);
			return { data: frame.rows };
		}
		// traces
		const frame =
			mode === "aggregate"
				? await adapter.aggregateSpans(query)
				: mode === "list"
					? await adapter.listSpans(query)
					: await adapter.spanTimeSeries(query);
		return { data: frame.rows };
	} catch (e) {
		if (e instanceof UnsupportedCapabilityError) {
			return { err: e.message };
		}
		return { err: getMessage().WIDGET_STRUCTURED_QUERY_FAILED };
	}
}

export async function runWidgetQuery(
	widgetId: string,
	{
		userQuery,
		filter,
		sourceId: sourceIdOverride,
		signal: signalOverride,
	}: {
		userQuery?: string;
		filter: MetricParams;
		sourceId?: string | null;
		signal?: Signal;
	}
) {
	const { data: widget, err: widgetErr } = await getWidgetById(widgetId);

	if (widgetErr || !widget) {
		return { err: getMessage().WIDGET_FETCH_FAILED };
	}

	const config = widget.config || {};
	const sourceId = sourceIdOverride ?? config.sourceId ?? null;
	const signal = (signalOverride ?? config.signal) as Signal | undefined;
	const structured = config.structuredQuery;

	// Legacy fast path: no source ref and no structured query -> raw SQL on the
	// caller's current ClickHouse config (zero behavior change for old widgets).
	if (!sourceId && !signal && !structured) {
		return runRawClickHouseWidgetQuery(
			userQuery ? userQuery : config.query || "",
			filter
		);
	}

	// Lazy import breaks the common <-> board <-> widget cycle (see top-of-file
	// note): the datasource graph is only pulled in at call time, off the
	// static concatenation path.
	const {
		getTelemetryAdapter,
		resolveTelemetrySourceDescriptor,
		sourceSupportsNativeSql,
	} = await import("@/lib/telemetry-source");

	const descriptor = await resolveTelemetrySourceDescriptor({ sourceId, signal });

	// Built-in ClickHouse: raw SQL allowed; thread the resolved dbConfigId.
	if (sourceSupportsNativeSql(descriptor)) {
		return runRawClickHouseWidgetQuery(
			userQuery ? userQuery : config.query || "",
			filter,
			descriptor.dbConfigId
		);
	}

	// External source: raw SQL is not supported; require a structured query.
	if (userQuery || (config.query && !structured)) {
		return { err: getMessage().WIDGET_RAW_SQL_SOURCE_ONLY(descriptor.name) };
	}
	if (!structured) {
		return { err: getMessage().WIDGET_NO_STRUCTURED_QUERY };
	}

	const adapter = await getTelemetryAdapter({ sourceId, signal });
	return executeStructuredWidgetQuery(adapter, structured, filter);
}
