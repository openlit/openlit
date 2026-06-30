"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseExporters = parseExporters;
exports.parseBoolEnv = parseBoolEnv;
/**
 * Parse a comma-separated OTel exporter env var into an array of exporter names.
 * Returns null if the env var is not set (caller uses default logic).
 * Matches Python's parse_exporters() in __helpers.py.
 */
function parseExporters(envVarName) {
    const val = process.env[envVarName];
    if (!val)
        return null;
    return val
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
}
/**
 * Parse a boolean-like env var (true/1/yes -> true, false/0/no -> false).
 * Returns undefined if the env var is not set.
 */
function parseBoolEnv(envVarName) {
    const val = process.env[envVarName];
    if (val === undefined || val === '')
        return undefined;
    const lower = val.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(lower))
        return true;
    if (['false', '0', 'no'].includes(lower))
        return false;
    return undefined;
}
//# sourceMappingURL=utils.js.map