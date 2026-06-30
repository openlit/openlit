"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPInstrumentationContext = void 0;
exports.setMCPSpanAttributes = setMCPSpanAttributes;
exports.captureRequestPayload = captureRequestPayload;
exports.captureResponsePayload = captureResponsePayload;
exports.recordMCPMetrics = recordMCPMetrics;
exports.wrapWithMCPSpan = wrapWithMCPSpan;
exports.patchCallTool = patchCallTool;
exports.patchListTools = patchListTools;
exports.patchGetPrompt = patchGetPrompt;
exports.patchListPrompts = patchListPrompts;
exports.patchReadResource = patchReadResource;
exports.patchListResources = patchListResources;
exports.patchClientSessionSendRequest = patchClientSessionSendRequest;
exports.patchClientSessionInitialize = patchClientSessionInitialize;
exports.patchServerRun = patchServerRun;
exports.patchServerCallTool = patchServerCallTool;
exports.patchServerListTools = patchServerListTools;
exports.patchServerReadResource = patchServerReadResource;
exports.patchServerListResources = patchServerListResources;
exports.patchTransport = patchTransport;
exports.patchServerSessionOperation = patchServerSessionOperation;
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const helpers_2 = require("../../helpers");
const constant_1 = require("../../constant");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const metrics_1 = __importDefault(require("../../otel/metrics"));
const MCP_SYSTEM = 'mcp';
function getStringField(obj, key) {
    if (obj && typeof obj === 'object' && key in obj) {
        const v = obj[key];
        return typeof v === 'string' ? v : undefined;
    }
    return undefined;
}
function safeStringify(val, maxLen = 4096) {
    try {
        const s = JSON.stringify(val, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
        return s.length > maxLen ? s.slice(0, maxLen) : s;
    }
    catch {
        return undefined;
    }
}
/**
 * Extracts the first meaningful string argument — used for tool name, prompt name,
 * or resource URI when the first arg is a plain string instead of an object.
 */
function extractStringArg(args) {
    if (args.length > 0 && typeof args[0] === 'string')
        return args[0];
    return undefined;
}
/**
 * Cache for expensive context extractions, mirroring Python's
 * MCPInstrumentationContext pattern.
 */
class MCPInstrumentationContext {
    constructor(instance, args, kwargs) {
        this.instance = instance;
        this.args = args;
        this.kwargs = kwargs;
    }
    get methodName() {
        if (this._methodName === undefined)
            this._methodName = this.extractMethodName();
        return this._methodName;
    }
    get toolName() {
        if (this._toolName === undefined)
            this._toolName = this.extractToolName();
        return this._toolName;
    }
    get resourceUri() {
        if (this._resourceUri === undefined)
            this._resourceUri = this.extractResourceUri();
        return this._resourceUri;
    }
    get transportType() {
        if (this._transportType === undefined)
            this._transportType = this.extractTransportType();
        return this._transportType;
    }
    extractMethodName() {
        const name = this.kwargs['name'];
        if (typeof name === 'string')
            return name;
        const method = this.kwargs['method'];
        if (typeof method === 'string')
            return method;
        const strArg = extractStringArg(this.args);
        if (strArg)
            return strArg;
        const inst = this.instance;
        if (inst && typeof inst['name'] === 'string')
            return inst['name'];
        return 'unknown';
    }
    extractToolName() {
        const name = getStringField(this.kwargs, 'name');
        if (name)
            return name;
        const strArg = extractStringArg(this.args);
        if (strArg)
            return strArg;
        const arg0 = this.args[0];
        if (arg0 && typeof arg0 === 'object') {
            const n = getStringField(arg0, 'name');
            if (n)
                return n;
        }
        return undefined;
    }
    extractResourceUri() {
        const uri = getStringField(this.kwargs, 'uri');
        if (uri)
            return uri;
        const strArg = extractStringArg(this.args);
        if (strArg)
            return strArg;
        const arg0 = this.args[0];
        if (arg0 && typeof arg0 === 'object') {
            const u = getStringField(arg0, 'uri');
            if (u)
                return u;
        }
        return undefined;
    }
    extractTransportType() {
        // Detect from instance class name / module
        const inst = this.instance;
        if (inst) {
            const className = (inst.constructor?.name || '').toLowerCase();
            if (className.includes('stdio'))
                return semantic_convention_1.default.MCP_TRANSPORT_STDIO;
            if (className.includes('sse'))
                return semantic_convention_1.default.MCP_TRANSPORT_SSE;
            if (className.includes('websocket'))
                return semantic_convention_1.default.MCP_TRANSPORT_WEBSOCKET;
        }
        // Detect from kwargs
        if (this.kwargs['command'] || this.kwargs['args'])
            return semantic_convention_1.default.MCP_TRANSPORT_STDIO;
        if (this.kwargs['url']) {
            const url = String(this.kwargs['url']);
            if (url.includes('sse'))
                return semantic_convention_1.default.MCP_TRANSPORT_SSE;
            if (url.includes('ws'))
                return semantic_convention_1.default.MCP_TRANSPORT_WEBSOCKET;
        }
        return semantic_convention_1.default.MCP_TRANSPORT_STDIO;
    }
}
exports.MCPInstrumentationContext = MCPInstrumentationContext;
/** Core MCP span attributes set on every span. */
function setMCPSpanAttributes(span, operationName, ctx, captureMessageContent, version) {
    const applicationName = config_1.default.applicationName || '';
    const environment = config_1.default.environment || '';
    span.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, constant_1.SDK_NAME);
    span.setAttribute(semantic_convention_1.default.MCP_OPERATION, operationName);
    span.setAttribute(semantic_convention_1.default.MCP_SYSTEM, MCP_SYSTEM);
    span.setAttribute(semantic_convention_1.default.MCP_SDK_VERSION, version);
    span.setAttribute(semantic_conventions_1.SEMRESATTRS_DEPLOYMENT_ENVIRONMENT, environment);
    span.setAttribute(semantic_conventions_1.SEMRESATTRS_SERVICE_NAME, applicationName);
    span.setAttribute(semantic_convention_1.default.MCP_TRANSPORT_TYPE, ctx.transportType);
    if (ctx.toolName) {
        span.setAttribute(semantic_convention_1.default.MCP_TOOL_NAME, ctx.toolName);
    }
    if (ctx.resourceUri) {
        span.setAttribute(semantic_convention_1.default.MCP_RESOURCE_URI, ctx.resourceUri);
    }
    if (ctx.methodName) {
        span.setAttribute(semantic_convention_1.default.MCP_METHOD, ctx.methodName);
    }
    (0, helpers_2.applyCustomSpanAttributes)(span);
}
/** Capture request payload if enabled. */
function captureRequestPayload(span, ctx, captureMessageContent) {
    if (!captureMessageContent)
        return;
    const payload = safeStringify({ method: ctx.methodName, kwargs: ctx.kwargs });
    if (payload) {
        span.setAttribute(semantic_convention_1.default.MCP_REQUEST_PAYLOAD, payload);
    }
}
/** Capture response payload if enabled. */
function captureResponsePayload(span, response, captureMessageContent) {
    if (!captureMessageContent || response === null || response === undefined)
        return;
    const payload = safeStringify(response);
    if (payload) {
        span.setAttribute(semantic_convention_1.default.MCP_RESPONSE_PAYLOAD, payload);
    }
}
/** Record MCP-specific metrics, mirroring Python's record_mcp_metrics. */
function recordMCPMetrics(params) {
    const { mcpOperation, mcpMethod, mcpTransportType, toolName, resourceUri, promptName, duration, requestSize, responseSize, isError, } = params;
    const applicationName = config_1.default.applicationName || '';
    const environment = config_1.default.environment || '';
    const enhancedAttributes = {
        [semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME]: constant_1.SDK_NAME,
        [semantic_conventions_1.SEMRESATTRS_SERVICE_NAME]: applicationName,
        [semantic_conventions_1.SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
        [semantic_convention_1.default.MCP_OPERATION]: mcpOperation,
        [semantic_convention_1.default.MCP_METHOD]: mcpMethod,
        [semantic_convention_1.default.MCP_SYSTEM]: MCP_SYSTEM,
        [semantic_convention_1.default.MCP_TRANSPORT_TYPE]: mcpTransportType,
    };
    if (toolName)
        enhancedAttributes[semantic_convention_1.default.MCP_TOOL_NAME] = toolName;
    if (resourceUri)
        enhancedAttributes[semantic_convention_1.default.MCP_RESOURCE_URI] = resourceUri;
    if (promptName)
        enhancedAttributes[semantic_convention_1.default.MCP_PROMPT_NAME] = promptName;
    if (mcpTransportType === 'stdio') {
        enhancedAttributes[semantic_convention_1.default.MCP_CLIENT_TYPE] = 'external_spawn';
    }
    else if (mcpTransportType === 'sse' || mcpTransportType === 'websocket') {
        enhancedAttributes[semantic_convention_1.default.MCP_CLIENT_TYPE] = 'network_client';
    }
    metrics_1.default.mcpRequests?.add(1, enhancedAttributes);
    metrics_1.default.mcpClientOperationDuration?.record(duration, enhancedAttributes);
    if (requestSize !== undefined) {
        metrics_1.default.mcpRequestSize?.record(requestSize, enhancedAttributes);
    }
    if (responseSize !== undefined) {
        metrics_1.default.mcpResponseSize?.record(responseSize, enhancedAttributes);
    }
    if (mcpTransportType) {
        metrics_1.default.mcpTransportUsage?.add(1, enhancedAttributes);
    }
    if (toolName) {
        metrics_1.default.mcpToolCalls?.add(1, enhancedAttributes);
    }
    if (resourceUri) {
        metrics_1.default.mcpResourceReads?.add(1, enhancedAttributes);
    }
    if (promptName) {
        metrics_1.default.mcpPromptGets?.add(1, enhancedAttributes);
    }
    const errorCount = isError ? 1 : 0;
    metrics_1.default.mcpErrors?.add(errorCount, {
        ...enhancedAttributes,
        'mcp.error': isError,
    });
    const successRate = isError ? 0.0 : 1.0;
    metrics_1.default.mcpOperationSuccessRate?.record(successRate, enhancedAttributes);
}
// ---------------------------------------------------------------------------
// Span name helpers — align with Python's get_enhanced_span_name
// ---------------------------------------------------------------------------
function spanNameForToolCall(method, _toolName) {
    if (method === 'listTools' || method === 'list_tools')
        return 'mcp tools/list';
    return `mcp tools/call`;
}
function spanNameForResource(method) {
    if (method === 'listResources' || method === 'list_resources')
        return 'mcp resources/list';
    if (method === 'readResource' || method === 'read_resource')
        return 'mcp resources/read';
    return 'mcp resources/operation';
}
function spanNameForPrompt(method) {
    if (method === 'listPrompts' || method === 'list_prompts')
        return 'mcp prompts/list';
    if (method === 'getPrompt' || method === 'get_prompt')
        return 'mcp prompts/get';
    return 'mcp prompts/operation';
}
function spanNameForTransport(endpoint) {
    if (endpoint.includes('stdio'))
        return 'mcp transport/stdio';
    if (endpoint.includes('sse'))
        return 'mcp transport/sse';
    if (endpoint.includes('websocket'))
        return 'mcp transport/websocket';
    if (endpoint.includes('streamablehttp') || endpoint.includes('streamable_http') || endpoint.includes('http'))
        return 'mcp transport/http';
    return 'mcp transport/operation';
}
function wrapWithMCPSpan(opts) {
    const { tracer, spanName, spanKind, operationName, ctx, version, toolName, resourceUri, promptName, fn, onResponse, } = opts;
    const captureContent = config_1.default.captureMessageContent || false;
    const span = tracer.startSpan(spanName, { kind: spanKind });
    const startTime = Date.now();
    return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
        try {
            setMCPSpanAttributes(span, operationName, ctx, captureContent, version);
            if (toolName)
                span.setAttribute(semantic_convention_1.default.MCP_TOOL_NAME, toolName);
            if (resourceUri)
                span.setAttribute(semantic_convention_1.default.MCP_RESOURCE_URI, resourceUri);
            if (promptName)
                span.setAttribute(semantic_convention_1.default.MCP_PROMPT_NAME, promptName);
            captureRequestPayload(span, ctx, captureContent);
            const response = await fn();
            const duration = (Date.now() - startTime) / 1000;
            span.setAttribute(semantic_convention_1.default.MCP_CLIENT_OPERATION_DURATION, duration);
            captureResponsePayload(span, response, captureContent);
            if (onResponse)
                onResponse(span, response);
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
        }
        catch (error) {
            const duration = (Date.now() - startTime) / 1000;
            helpers_1.default.handleException(span, error);
            span.setAttribute(semantic_convention_1.default.MCP_ERROR_MESSAGE, error?.message || String(error));
            if (error?.code) {
                span.setAttribute(semantic_convention_1.default.MCP_ERROR_CODE, String(error.code));
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
        }
        finally {
            span.end();
        }
    });
}
// ---------------------------------------------------------------------------
// Client method patchers
// ---------------------------------------------------------------------------
function patchCallTool(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const toolName = extractStringArg(args) || getStringField(args[0], 'name') || 'unknown';
            const ctx = new MCPInstrumentationContext(this, args, { name: toolName });
            const spanName = spanNameForToolCall('callTool', toolName);
            return wrapWithMCPSpan({
                tracer, spanName, spanKind: api_1.SpanKind.CLIENT, operationName: 'tools_call',
                ctx, version, toolName,
                fn: () => originalMethod.apply(this, args),
                onResponse: (span, response) => {
                    if (response?.content && config_1.default.captureMessageContent) {
                        span.setAttribute(semantic_convention_1.default.MCP_TOOL_RESULT, safeStringify(response.content) || '');
                    }
                    if (response?.isError) {
                        span.setAttribute(semantic_convention_1.default.MCP_ERROR_MESSAGE, safeStringify(response.content) || 'tool error');
                    }
                },
            });
        };
    };
}
function patchListTools(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const ctx = new MCPInstrumentationContext(this, args, {});
            return wrapWithMCPSpan({
                tracer, spanName: 'mcp tools/list', spanKind: api_1.SpanKind.CLIENT, operationName: 'tools_list',
                ctx, version,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
function patchGetPrompt(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const promptName = extractStringArg(args) || getStringField(args[0], 'name') || 'unknown';
            const ctx = new MCPInstrumentationContext(this, args, { name: promptName });
            const spanName = spanNameForPrompt('getPrompt');
            return wrapWithMCPSpan({
                tracer, spanName, spanKind: api_1.SpanKind.CLIENT, operationName: 'prompts_get',
                ctx, version, promptName,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
function patchListPrompts(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const ctx = new MCPInstrumentationContext(this, args, {});
            return wrapWithMCPSpan({
                tracer, spanName: 'mcp prompts/list', spanKind: api_1.SpanKind.CLIENT, operationName: 'prompts_list',
                ctx, version,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
function patchReadResource(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const resourceUri = extractStringArg(args) || getStringField(args[0], 'uri') || 'unknown';
            const ctx = new MCPInstrumentationContext(this, args, { uri: resourceUri });
            const spanName = spanNameForResource('readResource');
            return wrapWithMCPSpan({
                tracer, spanName, spanKind: api_1.SpanKind.CLIENT, operationName: 'resources_read',
                ctx, version, resourceUri,
                fn: () => originalMethod.apply(this, args),
                onResponse: (span, response) => {
                    if (response && config_1.default.captureMessageContent) {
                        if (response.contents) {
                            span.setAttribute(semantic_convention_1.default.MCP_RESOURCE_SIZE, safeStringify(response.contents)?.length || 0);
                        }
                        if (response.mimeType) {
                            span.setAttribute(semantic_convention_1.default.MCP_RESOURCE_MIME_TYPE, String(response.mimeType));
                        }
                    }
                },
            });
        };
    };
}
function patchListResources(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const ctx = new MCPInstrumentationContext(this, args, {});
            return wrapWithMCPSpan({
                tracer, spanName: 'mcp resources/list', spanKind: api_1.SpanKind.CLIENT, operationName: 'resources_list',
                ctx, version,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
// ---------------------------------------------------------------------------
// ClientSession method patchers (lower-level session operations)
// ---------------------------------------------------------------------------
function patchClientSessionSendRequest(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const ctx = new MCPInstrumentationContext(this, args, {});
            return wrapWithMCPSpan({
                tracer, spanName: 'mcp transport/request', spanKind: api_1.SpanKind.CLIENT, operationName: 'transport_request',
                ctx, version,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
function patchClientSessionInitialize(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const ctx = new MCPInstrumentationContext(this, args, {});
            return wrapWithMCPSpan({
                tracer, spanName: 'mcp initialize', spanKind: api_1.SpanKind.CLIENT, operationName: 'initialize',
                ctx, version,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
// ---------------------------------------------------------------------------
// Server method patchers
// ---------------------------------------------------------------------------
function patchServerRun(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const ctx = new MCPInstrumentationContext(this, args, {});
            return wrapWithMCPSpan({
                tracer, spanName: 'mcp server/run', spanKind: api_1.SpanKind.SERVER, operationName: 'server_run',
                ctx, version,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
function patchServerCallTool(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const toolName = extractStringArg(args) || getStringField(args[0], 'name') || 'unknown';
            const ctx = new MCPInstrumentationContext(this, args, { name: toolName });
            return wrapWithMCPSpan({
                tracer, spanName: spanNameForToolCall('callTool', toolName), spanKind: api_1.SpanKind.SERVER, operationName: 'tools_call',
                ctx, version, toolName,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
function patchServerListTools(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const ctx = new MCPInstrumentationContext(this, args, {});
            return wrapWithMCPSpan({
                tracer, spanName: 'mcp tools/list', spanKind: api_1.SpanKind.SERVER, operationName: 'tools_list',
                ctx, version,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
function patchServerReadResource(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const resourceUri = extractStringArg(args) || getStringField(args[0], 'uri') || 'unknown';
            const ctx = new MCPInstrumentationContext(this, args, { uri: resourceUri });
            return wrapWithMCPSpan({
                tracer, spanName: 'mcp resources/read', spanKind: api_1.SpanKind.SERVER, operationName: 'resources_read',
                ctx, version, resourceUri,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
function patchServerListResources(tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const ctx = new MCPInstrumentationContext(this, args, {});
            return wrapWithMCPSpan({
                tracer, spanName: 'mcp resources/list', spanKind: api_1.SpanKind.SERVER, operationName: 'resources_list',
                ctx, version,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
// ---------------------------------------------------------------------------
// Transport method patchers
// ---------------------------------------------------------------------------
function patchTransport(endpoint, tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const ctx = new MCPInstrumentationContext(this, args, {});
            const spanName = spanNameForTransport(endpoint);
            const isClient = endpoint.includes('client');
            const kind = isClient ? api_1.SpanKind.CLIENT : api_1.SpanKind.SERVER;
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
function patchServerSessionOperation(endpoint, tracer, version) {
    return (originalMethod) => {
        return async function (...args) {
            const ctx = new MCPInstrumentationContext(this, args, {});
            const spanName = `mcp server/${endpoint}`;
            return wrapWithMCPSpan({
                tracer, spanName, spanKind: api_1.SpanKind.SERVER, operationName: endpoint,
                ctx, version,
                fn: () => originalMethod.apply(this, args),
            });
        };
    };
}
//# sourceMappingURL=wrapper.js.map