import type { DatabaseConfig } from "@prisma/client";

/**
 * Tables written by the OTLP receiver with tenant attributes stamped into
 * `ResourceAttributes` (`openlit.project.id`, `organisation.environment.name`).
 */
export const TENANT_FILTERED_OTEL_TABLES = [
	"otel_traces",
	"otel_logs",
	"otel_metrics_gauge",
	"otel_metrics_sum",
	"otel_metrics_histogram",
	"otel_metrics_summary",
	"otel_metrics_exponential_histogram",
] as const;

const PROJECT_ATTRIBUTE = "openlit.project.id";
const ENVIRONMENT_ATTRIBUTE = "organisation.environment.name";
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_ENVIRONMENT = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const SAFE_DATABASE = /^[A-Za-z0-9_]{1,128}$/;

type TenantReadConfig = Pick<DatabaseConfig, "projectId" | "environment" | "database">;

function tenantReadFilterMode(): string {
	return (process.env.OPENLIT_TENANT_READ_FILTER || "").trim().toLowerCase();
}

export function isTenantReadFilterEnabled(): boolean {
	return !["0", "false", "off", "no"].includes(tenantReadFilterMode());
}

/**
 * `OPENLIT_TENANT_READ_FILTER=strict` also hides unstamped rows. Use it when
 * several projects share one ClickHouse database and the receiver requires
 * API keys, so every legitimate row carries a project.
 */
export function isTenantReadFilterStrict(): boolean {
	return tenantReadFilterMode() === "strict";
}

/**
 * Row predicate for one DatabaseConfig: rows stamped for another project or
 * environment are never readable through this config. Unstamped rows (ingest
 * without an API key) stay visible to the store owner unless strict mode is
 * on. Identifiers that are not safe to embed fail closed.
 */
export function tenantRowPredicate(config: TenantReadConfig): string | null {
	const projectId = (config.projectId || "").trim();
	if (!projectId) return null;
	const environment = (config.environment || "production").trim();
	if (!SAFE_IDENTIFIER.test(projectId) || !SAFE_ENVIRONMENT.test(environment)) {
		return "0";
	}
	if (isTenantReadFilterStrict()) {
		return (
			`ResourceAttributes['${PROJECT_ATTRIBUTE}'] = '${projectId}' AND ` +
			`ResourceAttributes['${ENVIRONMENT_ATTRIBUTE}'] = '${environment}'`
		);
	}
	return (
		`ResourceAttributes['${PROJECT_ATTRIBUTE}'] IN ('', '${projectId}') AND ` +
		`ResourceAttributes['${ENVIRONMENT_ATTRIBUTE}'] IN ('', '${environment}')`
	);
}

function quoteMapString(value: string): string {
	return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * ClickHouse `additional_table_filters` settings that enforce the tenant
 * predicate on every read of the OTLP tables, including native SQL, joins,
 * subqueries, and `INSERT ... SELECT` materialisation.
 */
export function tenantReadFilterSettings(
	config: TenantReadConfig
): Record<string, string> | undefined {
	if (!isTenantReadFilterEnabled()) return undefined;
	const predicate = tenantRowPredicate(config);
	if (!predicate) return undefined;
	const database = (config.database || "").trim();
	const entries: string[] = [];
	for (const table of TENANT_FILTERED_OTEL_TABLES) {
		entries.push(`${quoteMapString(table)}:${quoteMapString(predicate)}`);
		if (database && SAFE_DATABASE.test(database)) {
			entries.push(`${quoteMapString(`${database}.${table}`)}:${quoteMapString(predicate)}`);
		}
	}
	return { additional_table_filters: `{${entries.join(",")}}` };
}
