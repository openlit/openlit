// Single source of truth for escaping a string interpolated into a ClickHouse
// SQL string literal. Previously this was duplicated in ~7 files; hoisting it
// means a future hardening applies everywhere at once.
//
// It escapes backslashes and single quotes (preventing the value from breaking
// out of a '...' literal) and strips C0 control characters / DEL, which have no
// legitimate place in these identifiers and could otherwise corrupt a query or
// the JSONEachRow stream.
export function escapeClickHouseString(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'")
		// eslint-disable-next-line no-control-regex
		.replace(/[\x00-\x1f\x7f]/g, "");
}

const ALLOWED_ORDER_DIRECTIONS = new Set(["ASC", "DESC"]);

/** ClickHouse ORDER BY direction. Unknown values fall back to DESC. */
export function sanitizeOrderByDirection(direction: unknown): "ASC" | "DESC" {
	const normalized = String(direction ?? "")
		.trim()
		.toUpperCase();
	if (ALLOWED_ORDER_DIRECTIONS.has(normalized)) {
		return normalized as "ASC" | "DESC";
	}
	return "DESC";
}

/**
 * Exact ORDER BY expressions the Requests UI and existing tests send.
 * Anything else becomes `Timestamp DESC` so interpolated SQL cannot 500
 * or inject.
 */
const REQUESTS_ORDER_BY_TYPES = new Set([
	"Timestamp",
	"Duration",
	"SpanName",
	"SeverityText",
	"gen_ai.usage.cost",
	"gen_ai.usage.prompt_tokens",
	"gen_ai.usage.input_tokens",
	"SpanAttributes['gen_ai.usage.cost']",
	"SpanAttributes['gen_ai.usage.total_tokens']",
	"SpanAttributes['gen_ai.usage.input_tokens']",
	"SpanAttributes['gen_ai.usage.prompt_tokens']",
]);

export function buildRequestsOrderByClause(
	type: unknown,
	direction: unknown
): string {
	const dir = sanitizeOrderByDirection(direction);
	const column = String(type ?? "");
	if (!REQUESTS_ORDER_BY_TYPES.has(column)) {
		return "ORDER BY Timestamp DESC";
	}
	if (column.includes("cost")) {
		return `ORDER BY toFloat64OrZero(${column}) ${dir}`;
	}
	if (column.includes("tokens")) {
		return `ORDER BY toInt32OrZero(${column}) ${dir}`;
	}
	return `ORDER BY ${column} ${dir}`;
}
