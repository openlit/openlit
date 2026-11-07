import { RunTraceContext, inject } from './trace-context';
import OpenlitConfig from './config';

export type CodingAgentEnvOptions = {
  vendor: 'claude-code';
  /** Reported as `openlit.caller.service`; `service.name` stays the vendor's. */
  serviceName?: string;
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, string>;
  /** Send prompts and tool bodies. Off unless asked for. */
  captureContent?: boolean;
  /** Attributes added to the child's resource. */
  resourceAttributes?: Record<string, string>;
  /** Link to this trace instead of the active span. */
  parent?: RunTraceContext;
};

// The OTEL_* `key=value,...` format separates pairs with `,` and `=`.
function encodePairs(pairs: Record<string, unknown>): string {
  return Object.entries(pairs)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join(',');
}

function parentTraceparent(parent?: RunTraceContext): string | undefined {
  return parent ? `00-${parent.traceId}-${parent.spanId}-01` : inject();
}

/**
 * Environment that makes a headless coding agent send its own telemetry. Use it
 * where hooks and plugins are off, such as `claude -p` with restricted settings.
 * The result includes the current environment, so it can be passed to `spawn`
 * as it is.
 *
 * `service.name` is left to the vendor, because the Agents hub uses it to
 * recognise the agent, so an inherited `OTEL_SERVICE_NAME` is removed. The caller
 * is recorded in resource attributes instead, and `TRACEPARENT` is set for vendors
 * that read it. Those that do not can still be joined to the caller through
 * `openlit.parent.trace_id`.
 */
/**
 * An inherited service name would stop the Agents hub recognising the agent, and
 * an inherited content flag would export prompts, tool content or raw API bodies
 * nobody asked for. Every `OTEL_LOG_*` flag goes, because a vendor may add more,
 * except `OTEL_LOG_LEVEL`, which carries no content. Matches the CLI's list.
 */
function removedFromChild(name: string): boolean {
  return name === 'OTEL_SERVICE_NAME' || (name.startsWith('OTEL_LOG_') && name !== 'OTEL_LOG_LEVEL');
}

export function codingAgentEnv(options: CodingAgentEnvOptions): Record<string, string> {
  if (options.vendor !== 'claude-code') {
    throw new Error(`OpenLIT: no native telemetry settings for coding agent "${options.vendor}"`);
  }

  const endpoint = options.otlpEndpoint ?? OpenlitConfig.otlpEndpoint;
  const headers = options.otlpHeaders ?? (OpenlitConfig.otlpHeaders as Record<string, string> | undefined);
  const caller = options.serviceName ?? OpenlitConfig.applicationName;
  const traceparent = parentTraceparent(options.parent);
  const [, traceId, spanId] = traceparent?.split('-') ?? [];

  const attributes: Record<string, string> = {
    'gen_ai.agent.name': 'claude-code',
    ...(caller && caller !== 'default' ? { 'openlit.caller.service': caller } : {}),
    ...(traceId ? { 'openlit.parent.trace_id': traceId, 'openlit.parent.span_id': spanId } : {}),
    ...options.resourceAttributes,
  };

  const inherited = { ...process.env } as Record<string, string>;
  for (const name of Object.keys(inherited)) {
    if (removedFromChild(name)) delete inherited[name];
  }
  const resourceAttributes = [inherited.OTEL_RESOURCE_ATTRIBUTES, encodePairs(attributes)].filter(Boolean);

  const env: Record<string, string> = {
    ...inherited,
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: inherited.OTEL_EXPORTER_OTLP_PROTOCOL ?? 'http/json',
    OTEL_METRICS_INCLUDE_SESSION_ID: '1',
    OTEL_METRICS_INCLUDE_VERSION: '1',
    OTEL_RESOURCE_ATTRIBUTES: resourceAttributes.join(','),
  };
  if (endpoint) env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint;
  if (headers && Object.keys(headers).length > 0) env.OTEL_EXPORTER_OTLP_HEADERS = encodePairs(headers);
  if (traceparent) env.TRACEPARENT = traceparent;
  if (options.captureContent) {
    env.OTEL_LOG_USER_PROMPTS = '1';
    env.OTEL_LOG_TOOL_DETAILS = '1';
  }
  return env;
}
