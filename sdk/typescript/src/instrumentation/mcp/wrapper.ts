import { SpanKind, Tracer, context, trace, Span, Attributes } from '@opentelemetry/api';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import { applyCustomSpanAttributes } from '../../helpers';
import { SDK_NAME } from '../../constant';
import SemanticConvention from '../../semantic-convention';
import Metrics from '../../otel/metrics';

const MCP_SYSTEM = 'mcp';

function getStringField(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)) {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}

function safeStringify(val: unknown, maxLen = 4096): string | undefined {
  try {
    const s = JSON.stringify(val, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  } catch {
    return undefined;
  }
}

/**
 * Extracts the first meaningful string argument — used for tool name, prompt name,
 * or resource URI when the first arg is a plain string instead of an object.
 */
function extractStringArg(args: unknown[]): string | undefined {
  if (args.length > 0 && typeof args[0] === 'string') return args[0];
  return undefined;
}

/**
 * Cache for expensive context extractions, mirroring Python's
 * MCPInstrumentationContext pattern.
 */
class MCPInstrumentationContext {
  private _methodName: string | undefined;
  private _toolName: string | undefined;
  private _resourceUri: string | undefined;
  private _transportType: string | undefined;

  constructor(
    readonly instance: unknown,
    readonly args: unknown[],
    readonly kwargs: Record<string, unknown>,
  ) {}

  get methodName(): string {
    if (this._methodName === undefined) this._methodName = this.extractMethodName();
    return this._methodName;
  }

  get toolName(): string | undefined {
    if (this._toolName === undefined) this._toolName = this.extractToolName();
    return this._toolName;
  }

  get resourceUri(): string | undefined {
    if (this._resourceUri === undefined) this._resourceUri = this.extractResourceUri();
    return this._resourceUri;
  }

  get transportType(): string {
    if (this._transportType === undefined) this._transportType = this.extractTransportType();
    return this._transportType;
  }

  private extractMethodName(): string {
    const name = this.kwargs['name'];
    if (typeof name === 'string') return name;
    const method = this.kwargs['method'];
    if (typeof method === 'string') return method;
    const strArg = extractStringArg(this.args);
    if (strArg) return strArg;
    const inst = this.instance as Record<string, unknown> | null;
    if (inst && typeof inst['name'] === 'string') return inst['name'] as string;
    return 'unknown';
  }

  private extractToolName(): string | undefined {
    const name = getStringField(this.kwargs, 'name');
    if (name) return name;
    const strArg = extractStringArg(this.args);
    if (strArg) return strArg;
    const arg0 = this.args[0];
    if (arg0 && typeof arg0 === 'object') {
      const n = getStringField(arg0, 'name');
      if (n) return n;
    }
    return undefined;
  }

  private extractResourceUri(): string | undefined {
    const uri = getStringField(this.kwargs, 'uri');
    if (uri) return uri;
    const strArg = extractStringArg(this.args);
    if (strArg) return strArg;
    const arg0 = this.args[0];
    if (arg0 && typeof arg0 === 'object') {
      const u = getStringField(arg0, 'uri');
      if (u) return u;
    }
    return undefined;
  }

  private extractTransportType(): string {
    // Detect from instance class name / module
    const inst = this.instance as Record<string, unknown> | null;
    if (inst) {
      const className = (inst.constructor?.name || '').toLowerCase();
      if (className.includes('stdio')) return SemanticConvention.MCP_TRANSPORT_STDIO;
      if (className.includes('sse')) return SemanticConvention.MCP_TRANSPORT_SSE;
      if (className.includes('websocket')) return SemanticConvention.MCP_TRANSPORT_WEBSOCKET;
    }
    // Detect from kwargs
    if (this.kwargs['command'] || this.kwargs['args']) return SemanticConvention.MCP_TRANSPORT_STDIO;
    if (this.kwargs['url']) {
      const url = String(this.kwargs['url']);
      if (url.includes('sse')) return SemanticConvention.MCP_TRANSPORT_SSE;
      if (url.includes('ws')) return SemanticConvention.MCP_TRANSPORT_WEBSOCKET;
    }
    return SemanticConvention.MCP_TRANSPORT_STDIO;
  }
}

/** Core MCP span attributes set on every span. */
function setMCPSpanAttributes(
  span: Span,
  operationName: string,
  ctx: MCPInstrumentationContext,
  captureMessageContent: boolean,
  version: string,
): void {
  const applicationName = OpenlitConfig.applicationName || '';
  const environment = OpenlitConfig.environment || '';

  span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
  span.setAttribute(SemanticConvention.MCP_OPERATION, operationName);
  span.setAttribute(SemanticConvention.MCP_SYSTEM, MCP_SYSTEM);
  span.setAttribute(SemanticConvention.MCP_SDK_VERSION, version);
  span.setAttribute(SEMRESATTRS_DEPLOYMENT_ENVIRONMENT, environment);
  span.setAttribute(SEMRESATTRS_SERVICE_NAME, applicationName);
  span.setAttribute(SemanticConvention.MCP_TRANSPORT_TYPE, ctx.transportType);

  if (ctx.toolName) {
    span.setAttribute(SemanticConvention.MCP_TOOL_NAME, ctx.toolName);
  }
  if (ctx.resourceUri) {
    span.setAttribute(SemanticConvention.MCP_RESOURCE_URI, ctx.resourceUri);
  }
  if (ctx.methodName) {
    span.setAttribute(SemanticConvention.MCP_METHOD, ctx.methodName);
  }

  applyCustomSpanAttributes(span);
}

/** Capture request payload if enabled. */
function captureRequestPayload(
  span: Span,
  ctx: MCPInstrumentationContext,
  captureMessageContent: boolean,
): void {
  if (!captureMessageContent) return;
  const payload = safeStringify({ method: ctx.methodName, kwargs: ctx.kwargs });
  if (payload) {
    span.setAttribute(SemanticConvention.MCP_REQUEST_PAYLOAD, payload);
  }
}

/** Capture response payload if enabled. */
function captureResponsePayload(
  span: Span,
  response: unknown,
  captureMessageContent: boolean,
): void {
  if (!captureMessageContent || response === null || response === undefined) return;
  const payload = safeStringify(response);
  if (payload) {
    span.setAttribute(SemanticConvention.MCP_RESPONSE_PAYLOAD, payload);
  }
}

/** Record MCP-specific metrics, mirroring Python's record_mcp_metrics. */
function recordMCPMetrics(params: {
  mcpOperation: string;
  mcpMethod: string;
  mcpTransportType: string;
  toolName?: string;
  resourceUri?: string;
  promptName?: string;
  duration: number;
  requestSize?: number;
  responseSize?: number;
  isError: boolean;
}): void {
  const {
    mcpOperation,
    mcpMethod,
    mcpTransportType,
    toolName,
    resourceUri,
    promptName,
    duration,
    requestSize,
    responseSize,
    isError,
  } = params;

  const applicationName = OpenlitConfig.applicationName || '';
  const environment = OpenlitConfig.environment || '';

  const enhancedAttributes: Attributes = {
    [ATTR_TELEMETRY_SDK_NAME]: SDK_NAME,
    [SEMRESATTRS_SERVICE_NAME]: applicationName,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
    [SemanticConvention.MCP_OPERATION]: mcpOperation,
    [SemanticConvention.MCP_METHOD]: mcpMethod,
    [SemanticConvention.MCP_SYSTEM]: MCP_SYSTEM,
    [SemanticConvention.MCP_TRANSPORT_TYPE]: mcpTransportType,
  };

  if (toolName) enhancedAttributes[SemanticConvention.MCP_TOOL_NAME] = toolName;
  if (resourceUri) enhancedAttributes[SemanticConvention.MCP_RESOURCE_URI] = resourceUri;
  if (promptName) enhancedAttributes[SemanticConvention.MCP_PROMPT_NAME] = promptName;

  if (mcpTransportType === 'stdio') {
    enhancedAttributes[SemanticConvention.MCP_CLIENT_TYPE] = 'external_spawn';
  } else if (mcpTransportType === 'sse' || mcpTransportType === 'websocket') {
    enhancedAttributes[SemanticConvention.MCP_CLIENT_TYPE] = 'network_client';
  }

  Metrics.mcpRequests?.add(1, enhancedAttributes);
  Metrics.mcpClientOperationDuration?.record(duration, enhancedAttributes);

  if (requestSize !== undefined) {
    Metrics.mcpRequestSize?.record(requestSize, enhancedAttributes);
  }
  if (responseSize !== undefined) {
    Metrics.mcpResponseSize?.record(responseSize, enhancedAttributes);
  }
  if (mcpTransportType) {
    Metrics.mcpTransportUsage?.add(1, enhancedAttributes);
  }
  if (toolName) {
    Metrics.mcpToolCalls?.add(1, enhancedAttributes);
  }
  if (resourceUri) {
    Metrics.mcpResourceReads?.add(1, enhancedAttributes);
  }
  if (promptName) {
    Metrics.mcpPromptGets?.add(1, enhancedAttributes);
  }

  const errorCount = isError ? 1 : 0;
  Metrics.mcpErrors?.add(errorCount, {
    ...enhancedAttributes,
    'mcp.error': isError,
  } as Attributes);

  const successRate = isError ? 0.0 : 1.0;
  Metrics.mcpOperationSuccessRate?.record(successRate, enhancedAttributes);
}

// ---------------------------------------------------------------------------
// Span name helpers — align with Python's get_enhanced_span_name
// ---------------------------------------------------------------------------

function spanNameForToolCall(method: string, _toolName?: string): string {
  if (method === 'listTools' || method === 'list_tools') return 'mcp tools/list';
  return `mcp tools/call`;
}

function spanNameForResource(method: string): string {
  if (method === 'listResources' || method === 'list_resources') return 'mcp resources/list';
  if (method === 'readResource' || method === 'read_resource') return 'mcp resources/read';
  return 'mcp resources/operation';
}

function spanNameForPrompt(method: string): string {
  if (method === 'listPrompts' || method === 'list_prompts') return 'mcp prompts/list';
  if (method === 'getPrompt' || method === 'get_prompt') return 'mcp prompts/get';
  return 'mcp prompts/operation';
}

function spanNameForTransport(endpoint: string): string {
  if (endpoint.includes('stdio')) return 'mcp transport/stdio';
  if (endpoint.includes('sse')) return 'mcp transport/sse';
  if (endpoint.includes('websocket')) return 'mcp transport/websocket';
  if (endpoint.includes('streamablehttp') || endpoint.includes('streamable_http') || endpoint.includes('http')) return 'mcp transport/http';
  return 'mcp transport/operation';
}

// ---------------------------------------------------------------------------
// Generic span wrapper — used for all MCP operations
// ---------------------------------------------------------------------------

interface MCPSpanOptions {
  tracer: Tracer;
  spanName: string;
  spanKind: SpanKind;
  operationName: string;
  ctx: MCPInstrumentationContext;
  version: string;
  toolName?: string;
  resourceUri?: string;
  promptName?: string;
  fn: () => Promise<unknown>;
  onResponse?: (span: Span, response: unknown) => void;
}

function wrapWithMCPSpan(opts: MCPSpanOptions): Promise<unknown> {
  const {
    tracer, spanName, spanKind, operationName, ctx, version,
    toolName, resourceUri, promptName, fn, onResponse,
  } = opts;
  const captureContent = OpenlitConfig.captureMessageContent || false;
  const span = tracer.startSpan(spanName, { kind: spanKind });
  const startTime = Date.now();

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      setMCPSpanAttributes(span, operationName, ctx, captureContent, version);
      if (toolName) span.setAttribute(SemanticConvention.MCP_TOOL_NAME, toolName);
      if (resourceUri) span.setAttribute(SemanticConvention.MCP_RESOURCE_URI, resourceUri);
      if (promptName) span.setAttribute(SemanticConvention.MCP_PROMPT_NAME, promptName);
      captureRequestPayload(span, ctx, captureContent);

      const response = await fn();
      const duration = (Date.now() - startTime) / 1000;

      span.setAttribute(SemanticConvention.MCP_CLIENT_OPERATION_DURATION, duration);
      captureResponsePayload(span, response, captureContent);
      if (onResponse) onResponse(span, response);

      recordMCPMetrics({
        mcpOperation: operationName,
        mcpMethod: ctx.methodName || operationName,
        mcpTransportType: ctx.transportType,
        toolName,
        resourceUri,
        promptName,
        duration,
        isError: false,
      });

      return response;
    } catch (error: any) {
      const duration = (Date.now() - startTime) / 1000;
      OpenLitHelper.handleException(span, error);
      span.setAttribute(SemanticConvention.MCP_ERROR_MESSAGE, error?.message || String(error));
      if (error?.code) {
        span.setAttribute(SemanticConvention.MCP_ERROR_CODE, String(error.code));
      }

      recordMCPMetrics({
        mcpOperation: operationName,
        mcpMethod: ctx.methodName || operationName,
        mcpTransportType: ctx.transportType,
        toolName,
        resourceUri,
        promptName,
        duration,
        isError: true,
      });

      throw error;
    } finally {
      span.end();
    }
  });
}

// ---------------------------------------------------------------------------
// Client method patchers
// ---------------------------------------------------------------------------

function patchCallTool(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const toolName = extractStringArg(args) || getStringField(args[0], 'name') || 'unknown';
      const ctx = new MCPInstrumentationContext(this, args, { name: toolName });
      const spanName = spanNameForToolCall('callTool', toolName);

      return wrapWithMCPSpan({
        tracer, spanName, spanKind: SpanKind.CLIENT, operationName: 'tools_call',
        ctx, version, toolName,
        fn: () => originalMethod.apply(this, args),
        onResponse: (span, response: any) => {
          if (response?.content && OpenlitConfig.captureMessageContent) {
            span.setAttribute(SemanticConvention.MCP_TOOL_RESULT, safeStringify(response.content) || '');
          }
          if (response?.isError) {
            span.setAttribute(SemanticConvention.MCP_ERROR_MESSAGE, safeStringify(response.content) || 'tool error');
          }
        },
      });
    };
  };
}

function patchListTools(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const ctx = new MCPInstrumentationContext(this, args, {});
      return wrapWithMCPSpan({
        tracer, spanName: 'mcp tools/list', spanKind: SpanKind.CLIENT, operationName: 'tools_list',
        ctx, version,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

function patchGetPrompt(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const promptName = extractStringArg(args) || getStringField(args[0], 'name') || 'unknown';
      const ctx = new MCPInstrumentationContext(this, args, { name: promptName });
      const spanName = spanNameForPrompt('getPrompt');

      return wrapWithMCPSpan({
        tracer, spanName, spanKind: SpanKind.CLIENT, operationName: 'prompts_get',
        ctx, version, promptName,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

function patchListPrompts(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const ctx = new MCPInstrumentationContext(this, args, {});
      return wrapWithMCPSpan({
        tracer, spanName: 'mcp prompts/list', spanKind: SpanKind.CLIENT, operationName: 'prompts_list',
        ctx, version,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

function patchReadResource(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const resourceUri = extractStringArg(args) || getStringField(args[0], 'uri') || 'unknown';
      const ctx = new MCPInstrumentationContext(this, args, { uri: resourceUri });
      const spanName = spanNameForResource('readResource');

      return wrapWithMCPSpan({
        tracer, spanName, spanKind: SpanKind.CLIENT, operationName: 'resources_read',
        ctx, version, resourceUri,
        fn: () => originalMethod.apply(this, args),
        onResponse: (span, response: any) => {
          if (response && OpenlitConfig.captureMessageContent) {
            if (response.contents) {
              span.setAttribute(SemanticConvention.MCP_RESOURCE_SIZE, safeStringify(response.contents)?.length || 0);
            }
            if (response.mimeType) {
              span.setAttribute(SemanticConvention.MCP_RESOURCE_MIME_TYPE, String(response.mimeType));
            }
          }
        },
      });
    };
  };
}

function patchListResources(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const ctx = new MCPInstrumentationContext(this, args, {});
      return wrapWithMCPSpan({
        tracer, spanName: 'mcp resources/list', spanKind: SpanKind.CLIENT, operationName: 'resources_list',
        ctx, version,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

// ---------------------------------------------------------------------------
// ClientSession method patchers (lower-level session operations)
// ---------------------------------------------------------------------------

function patchClientSessionSendRequest(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const ctx = new MCPInstrumentationContext(this, args, {});
      return wrapWithMCPSpan({
        tracer, spanName: 'mcp transport/request', spanKind: SpanKind.CLIENT, operationName: 'transport_request',
        ctx, version,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

function patchClientSessionInitialize(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const ctx = new MCPInstrumentationContext(this, args, {});
      return wrapWithMCPSpan({
        tracer, spanName: 'mcp initialize', spanKind: SpanKind.CLIENT, operationName: 'initialize',
        ctx, version,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

// ---------------------------------------------------------------------------
// Server method patchers
// ---------------------------------------------------------------------------

function patchServerRun(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const ctx = new MCPInstrumentationContext(this, args, {});
      return wrapWithMCPSpan({
        tracer, spanName: 'mcp server/run', spanKind: SpanKind.SERVER, operationName: 'server_run',
        ctx, version,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

function patchServerCallTool(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const toolName = extractStringArg(args) || getStringField(args[0], 'name') || 'unknown';
      const ctx = new MCPInstrumentationContext(this, args, { name: toolName });
      return wrapWithMCPSpan({
        tracer, spanName: spanNameForToolCall('callTool', toolName), spanKind: SpanKind.SERVER, operationName: 'tools_call',
        ctx, version, toolName,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

function patchServerListTools(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const ctx = new MCPInstrumentationContext(this, args, {});
      return wrapWithMCPSpan({
        tracer, spanName: 'mcp tools/list', spanKind: SpanKind.SERVER, operationName: 'tools_list',
        ctx, version,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

function patchServerReadResource(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const resourceUri = extractStringArg(args) || getStringField(args[0], 'uri') || 'unknown';
      const ctx = new MCPInstrumentationContext(this, args, { uri: resourceUri });
      return wrapWithMCPSpan({
        tracer, spanName: 'mcp resources/read', spanKind: SpanKind.SERVER, operationName: 'resources_read',
        ctx, version, resourceUri,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

function patchServerListResources(tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const ctx = new MCPInstrumentationContext(this, args, {});
      return wrapWithMCPSpan({
        tracer, spanName: 'mcp resources/list', spanKind: SpanKind.SERVER, operationName: 'resources_list',
        ctx, version,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

// ---------------------------------------------------------------------------
// Transport method patchers
// ---------------------------------------------------------------------------

function patchTransport(endpoint: string, tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const ctx = new MCPInstrumentationContext(this, args, {});
      const spanName = spanNameForTransport(endpoint);
      const isClient = endpoint.includes('client');
      const kind = isClient ? SpanKind.CLIENT : SpanKind.SERVER;
      return wrapWithMCPSpan({
        tracer, spanName, spanKind: kind, operationName: endpoint,
        ctx, version,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

// ---------------------------------------------------------------------------
// ServerSession method patchers
// ---------------------------------------------------------------------------

function patchServerSessionOperation(endpoint: string, tracer: Tracer, version: string): any {
  return (originalMethod: (...args: any[]) => any) => {
    return async function (this: any, ...args: any[]) {
      const ctx = new MCPInstrumentationContext(this, args, {});
      const spanName = `mcp server/${endpoint}`;
      return wrapWithMCPSpan({
        tracer, spanName, spanKind: SpanKind.SERVER, operationName: endpoint,
        ctx, version,
        fn: () => originalMethod.apply(this, args),
      });
    };
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  MCPInstrumentationContext,
  setMCPSpanAttributes,
  captureRequestPayload,
  captureResponsePayload,
  recordMCPMetrics,
  wrapWithMCPSpan,
  patchCallTool,
  patchListTools,
  patchGetPrompt,
  patchListPrompts,
  patchReadResource,
  patchListResources,
  patchClientSessionSendRequest,
  patchClientSessionInitialize,
  patchServerRun,
  patchServerCallTool,
  patchServerListTools,
  patchServerReadResource,
  patchServerListResources,
  patchTransport,
  patchServerSessionOperation,
};
