const ALLOWED_TABLES = [
	"otel_traces",
	"otel_metrics_gauge",
	"otel_metrics_sum",
	"otel_metrics_histogram",
];

const FORBIDDEN_KEYWORDS = [
	"INSERT",
	"UPDATE",
	"DELETE",
	"DROP",
	"CREATE",
	"ALTER",
	"TRUNCATE",
	"GRANT",
	"REVOKE",
	"RENAME",
	"ATTACH",
	"DETACH",
	"OPTIMIZE",
	"KILL",
];

export interface SQLValidationResult {
	valid: boolean;
	query?: string;
	error?: string;
}

export function validateSQL(query: string): SQLValidationResult {
	if (!query || typeof query !== "string" || query.trim().length === 0) {
		return { valid: false, error: "Empty query" };
	}

	let cleaned = query.trim();

	// Remove leading/trailing backticks or code block markers
	if (cleaned.startsWith("```sql")) {
		cleaned = cleaned.slice(6);
	} else if (cleaned.startsWith("```")) {
		cleaned = cleaned.slice(3);
	}
	if (cleaned.endsWith("```")) {
		cleaned = cleaned.slice(0, -3);
	}
	cleaned = cleaned.trim();

	// Remove trailing semicolons (ClickHouse client doesn't need them)
	while (cleaned.endsWith(";")) {
		cleaned = cleaned.slice(0, -1).trim();
	}

	// Check for forbidden DDL/DML keywords at statement start or after semicolons
	const upperQuery = cleaned.toUpperCase();
	for (const keyword of FORBIDDEN_KEYWORDS) {
		// Check if query starts with forbidden keyword
		if (upperQuery.startsWith(keyword + " ") || upperQuery.startsWith(keyword + "\n") || upperQuery.startsWith(keyword + "\t")) {
			return {
				valid: false,
				error: `Query contains forbidden operation: ${keyword}. Only SELECT queries are allowed.`,
			};
		}
	}

	// Must start with SELECT or WITH (for CTEs)
	if (!upperQuery.startsWith("SELECT") && !upperQuery.startsWith("WITH")) {
		return {
			valid: false,
			error: "Only SELECT queries (or WITH...SELECT) are allowed.",
		};
	}

	// Check that only allowed tables are referenced
	// Extract table names after FROM and JOIN keywords
	const fromJoinPattern = /(?:FROM|JOIN)\s+(\w+)/gi;
	let match;
	while ((match = fromJoinPattern.exec(cleaned)) !== null) {
		const tableName = match[1].toLowerCase();
		// Skip subquery aliases and CTEs
		if (tableName === "select" || tableName === "with") continue;
		if (!ALLOWED_TABLES.includes(tableName)) {
			return {
				valid: false,
				error: `Table "${match[1]}" is not allowed. Allowed tables: ${ALLOWED_TABLES.join(", ")}`,
			};
		}
	}

	// Enforce LIMIT clause — append if missing
	if (!/\bLIMIT\b/i.test(cleaned)) {
		cleaned = cleaned + "\nLIMIT 1000";
	}

	// Check that existing LIMIT is not unreasonably large
	const limitMatch = /\bLIMIT\s+(\d+)/i.exec(cleaned);
	if (limitMatch) {
		const limitValue = parseInt(limitMatch[1], 10);
		if (limitValue > 10000) {
			cleaned = cleaned.replace(
				/\bLIMIT\s+\d+/i,
				"LIMIT 1000"
			);
		}
	}

	return { valid: true, query: cleaned };
}

/**
 * Extract SQL queries from markdown-formatted LLM responses.
 * Looks for ```sql code blocks.
 */
export function extractSQLFromResponse(response: string): string[] {
	const sqlBlocks: string[] = [];
	const regex = /```sql\s*\n([\s\S]*?)```/gi;
	let match;

	while ((match = regex.exec(response)) !== null) {
		const sql = match[1].trim();
		if (sql.length > 0) {
			sqlBlocks.push(sql);
		}
	}

	return sqlBlocks;
}
