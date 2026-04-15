/**
 * Escape a string value for safe inclusion in a ClickHouse SQL single-quoted literal.
 * Prevents SQL injection by escaping single quotes.
 */
export function escapeStringValue(value: string): string {
	return value.replace(/'/g, "''");
}
