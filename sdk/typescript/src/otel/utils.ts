/**
 * Parse a comma-separated OTel exporter env var into an array of exporter names.
 * Returns null if the env var is not set (caller uses default logic).
 * Matches Python's parse_exporters() in __helpers.py.
 */
import { trace, metrics } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

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
export function parseBoolEnv(envVarName: string): boolean | undefined {
  const val = process.env[envVarName];
  if (val === undefined || val === '') return undefined;
  const lower = val.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(lower)) return true;
  if (['false', '0', 'no'].includes(lower)) return false;
  return undefined;
}

/**
 * Return the globally registered SDK TracerProvider, if any.
 *
 * Mirrors Python `isinstance(trace.get_tracer_provider(), TracerProvider)`.
 * On OTel >= 2.x the API returns a proxy; unwrap via `getDelegate()` first.
 */
export function getRegisteredTracerProvider(): BasicTracerProvider | undefined {
  const provider = trace.getTracerProvider() as { getDelegate?: () => unknown };
  const candidate =
    provider && typeof provider.getDelegate === 'function'
      ? provider.getDelegate()
      : provider;
  return candidate instanceof BasicTracerProvider ? candidate : undefined;
}

/**
 * Return the globally registered SDK MeterProvider, if any.
 *
 * Mirrors Python `isinstance(metrics.get_meter_provider(), MeterProvider)`.
 */
export function getRegisteredMeterProvider(): MeterProvider | undefined {
  const provider = metrics.getMeterProvider() as { getDelegate?: () => unknown };
  const candidate =
    provider && typeof provider.getDelegate === 'function'
      ? provider.getDelegate()
      : provider;
  return candidate instanceof MeterProvider ? candidate : undefined;
}
