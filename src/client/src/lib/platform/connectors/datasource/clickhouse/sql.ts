const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Quote a ClickHouse identifier for safe table/column references. */
export function quoteClickHouseIdentifier(name: string): string {
	const trimmed = String(name || "").trim();
	if (!trimmed || !SAFE_IDENTIFIER.test(trimmed)) {
		throw new Error("Invalid ClickHouse identifier");
	}
	return `\`${trimmed}\``;
}

/** Resolve the traces table with optional database qualification. */
export function qualifiedTracesTable(database?: string | null): string {
	const table = quoteClickHouseIdentifier("otel_traces");
	const db = String(database || "").trim();
	if (db && SAFE_IDENTIFIER.test(db)) {
		return `${quoteClickHouseIdentifier(db)}.${table}`;
	}
	return table;
}
