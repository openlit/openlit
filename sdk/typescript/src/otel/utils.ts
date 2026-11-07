/**
 * Parse a comma-separated OTel exporter env var into an array of exporter names.
 * Returns null if the env var is not set (caller uses default logic).
 * Matches Python's parse_exporters() in __helpers.py.
 */
export function parseExporters(envVarName: string): string[] | null {
  const val = process.env[envVarName];
  if (!val) return null;
  return val
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Parse a boolean-like env var (true/1/yes -> true, false/0/no -> false).
 * Returns undefined if the env var is not set.
 */
/**
 * Parse `OTEL_EXPORTER_OTLP_HEADERS`: `key=value` pairs separated by commas,
 * values percent-encoded as the OpenTelemetry spec says. A value may itself
 * contain `=`. Pairs without a key are skipped.
 */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const headers: Record<string, string> = {};
  for (const item of raw.split(',')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!key || key === '__proto__') continue;
    try {
      headers[key] = decodeURIComponent(value);
    } catch {
      headers[key] = value;
    }
  }
  return headers;
}

/** Parse a boolean setting the way the env vars are read: true/1/yes, false/0/no. */
export function parseBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const lower = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(lower)) return true;
  if (['false', '0', 'no'].includes(lower)) return false;
  return undefined;
}

export function parseBoolEnv(envVarName: string): boolean | undefined {
  return parseBool(process.env[envVarName]);
}
