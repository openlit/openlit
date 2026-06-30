/**
 * Parse a comma-separated OTel exporter env var into an array of exporter names.
 * Returns null if the env var is not set (caller uses default logic).
 * Matches Python's parse_exporters() in __helpers.py.
 */
export declare function parseExporters(envVarName: string): string[] | null;
/**
 * Parse a boolean-like env var (true/1/yes -> true, false/0/no -> false).
 * Returns undefined if the env var is not set.
 */
export declare function parseBoolEnv(envVarName: string): boolean | undefined;
