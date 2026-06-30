import { SpanKind, Tracer, Span } from '@opentelemetry/api';
/**
 * Cache for expensive context extractions, mirroring Python's
 * MCPInstrumentationContext pattern.
 */
declare class MCPInstrumentationContext {
    readonly instance: unknown;
    readonly args: unknown[];
    readonly kwargs: Record<string, unknown>;
    private _methodName;
    private _toolName;
    private _resourceUri;
    private _transportType;
    constructor(instance: unknown, args: unknown[], kwargs: Record<string, unknown>);
    get methodName(): string;
    get toolName(): string | undefined;
    get resourceUri(): string | undefined;
    get transportType(): string;
    private extractMethodName;
    private extractToolName;
    private extractResourceUri;
    private extractTransportType;
}
/** Core MCP span attributes set on every span. */
declare function setMCPSpanAttributes(span: Span, operationName: string, ctx: MCPInstrumentationContext, captureMessageContent: boolean, version: string): void;
/** Capture request payload if enabled. */
declare function captureRequestPayload(span: Span, ctx: MCPInstrumentationContext, captureMessageContent: boolean): void;
/** Capture response payload if enabled. */
declare function captureResponsePayload(span: Span, response: unknown, captureMessageContent: boolean): void;
/** Record MCP-specific metrics, mirroring Python's record_mcp_metrics. */
declare function recordMCPMetrics(params: {
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
}): void;
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
declare function wrapWithMCPSpan(opts: MCPSpanOptions): Promise<unknown>;
declare function patchCallTool(tracer: Tracer, version: string): any;
declare function patchListTools(tracer: Tracer, version: string): any;
declare function patchGetPrompt(tracer: Tracer, version: string): any;
declare function patchListPrompts(tracer: Tracer, version: string): any;
declare function patchReadResource(tracer: Tracer, version: string): any;
declare function patchListResources(tracer: Tracer, version: string): any;
declare function patchClientSessionSendRequest(tracer: Tracer, version: string): any;
declare function patchClientSessionInitialize(tracer: Tracer, version: string): any;
declare function patchServerRun(tracer: Tracer, version: string): any;
declare function patchServerCallTool(tracer: Tracer, version: string): any;
declare function patchServerListTools(tracer: Tracer, version: string): any;
declare function patchServerReadResource(tracer: Tracer, version: string): any;
declare function patchServerListResources(tracer: Tracer, version: string): any;
declare function patchTransport(endpoint: string, tracer: Tracer, version: string): any;
declare function patchServerSessionOperation(endpoint: string, tracer: Tracer, version: string): any;
export { MCPInstrumentationContext, setMCPSpanAttributes, captureRequestPayload, captureResponsePayload, recordMCPMetrics, wrapWithMCPSpan, patchCallTool, patchListTools, patchGetPrompt, patchListPrompts, patchReadResource, patchListResources, patchClientSessionSendRequest, patchClientSessionInitialize, patchServerRun, patchServerCallTool, patchServerListTools, patchServerReadResource, patchServerListResources, patchTransport, patchServerSessionOperation, };
