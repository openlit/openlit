"use strict";
/**
 * OpenLIT OpenAI Agents TracingProcessor implementation.
 *
 * Integrates with the @openai/agents TracingProcessor interface.
 * All span data fields are read at onSpanEnd (when fully populated).
 * Compliant with OTel GenAI semantic conventions.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenLITTracingProcessor = void 0;
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const constant_1 = require("../../constant");
const config_1 = __importDefault(require("../../config"));
const helpers_1 = require("../../helpers");
const utils_1 = require("./utils");
const [OPENAI_SERVER_ADDRESS, OPENAI_SERVER_PORT] = (0, helpers_1.getServerAddressForProvider)('openai');
const LLM_SPAN_TYPES = new Set(['response', 'generation']);
/**
 * TracingProcessor that emits OTel GenAI-compliant spans from
 * the @openai/agents SDK tracing lifecycle.
 *
 * Thread-safe by design: each trace/span entry is keyed independently.
 * LLM span types (response, generation) are skipped -- the OpenAI
 * provider instrumentation handles those with richer telemetry.
 */
class OpenLITTracingProcessor {
    constructor(tracer, agentCreationRegistry = null) {
        // SDK span_id -> SpanEntry
        this._otelSpans = new Map();
        // SDK trace_id -> TraceEntry
        this._rootSpans = new Map();
        // trace_id -> group_id (conversation id)
        this._traceGroupIds = new Map();
        // Agent handoff tracker (bounded Map)
        this._handoffTracker = new Map();
        this._tracer = tracer;
        this._agentCreationRegistry = agentCreationRegistry;
    }
    // ------------------------------------------------------------------
    // Trace lifecycle
    // ------------------------------------------------------------------
    async onTraceStart(sdkTrace) {
        try {
            const traceId = sdkTrace.traceId ?? 'unknown';
            const traceName = sdkTrace.name ?? 'workflow';
            const groupId = sdkTrace.groupId ?? null;
            const operation = semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK;
            const spanName = `${operation} ${traceName}`;
            const otelSpan = this._tracer.startSpan(spanName, {
                kind: api_1.SpanKind.INTERNAL,
                attributes: {
                    [semantic_convention_1.default.GEN_AI_OPERATION]: operation,
                    [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_OPENAI,
                },
            });
            const startTime = Date.now();
            this._rootSpans.set(traceId, { otelSpan, startTime });
            if (groupId) {
                this._traceGroupIds.set(traceId, String(groupId));
            }
            (0, helpers_1.setFrameworkParentContext)(api_1.trace.setSpan(api_1.context.active(), otelSpan));
        }
        catch {
            // swallow
        }
    }
    async onTraceEnd(sdkTrace) {
        try {
            const traceId = sdkTrace.traceId ?? 'unknown';
            const traceName = sdkTrace.name ?? 'workflow';
            const entry = this._rootSpans.get(traceId);
            this._rootSpans.delete(traceId);
            const groupId = this._traceGroupIds.get(traceId) ?? null;
            this._traceGroupIds.delete(traceId);
            if (!entry)
                return;
            const { otelSpan, startTime } = entry;
            const endTime = Date.now();
            const durationMs = endTime - startTime;
            // Set common framework attributes
            otelSpan.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, constant_1.SDK_NAME);
            otelSpan.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, constant_1.SDK_VERSION);
            otelSpan.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, semantic_convention_1.default.GEN_AI_SYSTEM_OPENAI);
            otelSpan.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK);
            if (OPENAI_SERVER_ADDRESS) {
                otelSpan.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
                if (OPENAI_SERVER_PORT) {
                    otelSpan.setAttribute(semantic_convention_1.default.SERVER_PORT, OPENAI_SERVER_PORT);
                }
            }
            otelSpan.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment ?? 'default');
            otelSpan.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName ?? 'default');
            otelSpan.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, durationMs / 1000);
            otelSpan.setAttribute(semantic_convention_1.default.GEN_AI_WORKFLOW_NAME, traceName);
            if (groupId) {
                otelSpan.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, groupId);
            }
            (0, helpers_1.applyCustomSpanAttributes)(otelSpan);
            // Error handling
            const error = sdkTrace.error;
            if (error) {
                const errorType = typeof error === 'object' && error !== null
                    ? error.constructor?.name || error.code || '_OTHER'
                    : '_OTHER';
                const errorMsg = typeof error === 'object' && error !== null
                    ? error.message ?? String(error)
                    : String(error);
                otelSpan.setAttribute(semantic_convention_1.default.ERROR_TYPE, errorType);
                otelSpan.setStatus({ code: api_1.SpanStatusCode.ERROR, message: errorMsg });
            }
            else {
                otelSpan.setStatus({ code: api_1.SpanStatusCode.OK });
            }
            // Metrics
            if (!config_1.default.disableMetrics) {
                (0, utils_1.recordMetrics)(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK, durationMs / 1000, null);
            }
            otelSpan.end();
            (0, helpers_1.clearFrameworkParentContext)();
        }
        catch {
            // swallow
        }
    }
    // ------------------------------------------------------------------
    // Span lifecycle
    // ------------------------------------------------------------------
    async onSpanStart(sdkSpan) {
        try {
            const spanData = sdkSpan.spanData;
            const spanType = spanData?.type ?? 'unknown';
            // Skip LLM span types -- let the OpenAI provider instrumentation handle them
            if (LLM_SPAN_TYPES.has(spanType))
                return;
            const traceId = sdkSpan.traceId ?? 'unknown';
            const sdkSpanId = sdkSpan.spanId ?? null;
            const parentSdkId = sdkSpan.parentId ?? null;
            const operation = (0, utils_1.getOperationType)(spanType);
            const kind = (0, utils_1.getSpanKind)(operation);
            const spanName = (0, utils_1.generateSpanName)(spanData);
            // Find parent OTel span context
            let parentCtx = api_1.context.active();
            if (parentSdkId && this._otelSpans.has(parentSdkId)) {
                const parentEntry = this._otelSpans.get(parentSdkId);
                parentCtx = api_1.trace.setSpan(api_1.context.active(), parentEntry.otelSpan);
            }
            else if (this._rootSpans.has(traceId)) {
                const rootEntry = this._rootSpans.get(traceId);
                parentCtx = api_1.trace.setSpan(api_1.context.active(), rootEntry.otelSpan);
            }
            // Span links: connect invoke_agent back to create_agent
            const links = [];
            if (spanType === 'agent' && this._agentCreationRegistry) {
                const agentName = spanData.name;
                if (agentName) {
                    const creationCtx = this._agentCreationRegistry.get(String(agentName));
                    if (creationCtx) {
                        links.push({ context: creationCtx, attributes: {} });
                    }
                }
            }
            const otelSpan = this._tracer.startSpan(spanName, {
                kind,
                links,
                attributes: {
                    [semantic_convention_1.default.GEN_AI_OPERATION]: operation,
                    [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_OPENAI,
                },
            }, parentCtx);
            const startTime = Date.now();
            if (sdkSpanId) {
                this._otelSpans.set(sdkSpanId, { otelSpan, startTime });
            }
            (0, helpers_1.setFrameworkParentContext)(api_1.trace.setSpan(parentCtx, otelSpan));
        }
        catch {
            // swallow
        }
    }
    async onSpanEnd(sdkSpan) {
        try {
            const spanData = sdkSpan.spanData;
            const spanType = spanData?.type ?? 'unknown';
            // Skip LLM span types
            if (LLM_SPAN_TYPES.has(spanType))
                return;
            const sdkSpanId = sdkSpan.spanId ?? null;
            const traceId = sdkSpan.traceId ?? 'unknown';
            if (!sdkSpanId)
                return;
            const entry = this._otelSpans.get(sdkSpanId);
            this._otelSpans.delete(sdkSpanId);
            if (!entry)
                return;
            const { otelSpan, startTime } = entry;
            const conversationId = this._traceGroupIds.get(traceId) ?? null;
            (0, utils_1.processSpanEnd)(otelSpan, sdkSpan, startTime, conversationId, this._handoffTracker);
            otelSpan.end();
            // Restore parent context so subsequent provider spans nest correctly
            const parentSdkId = sdkSpan.parentId ?? null;
            if (parentSdkId && this._otelSpans.has(parentSdkId)) {
                const parentEntry = this._otelSpans.get(parentSdkId);
                (0, helpers_1.setFrameworkParentContext)(api_1.trace.setSpan(api_1.context.active(), parentEntry.otelSpan));
            }
            else if (this._rootSpans.has(traceId)) {
                const rootEntry = this._rootSpans.get(traceId);
                (0, helpers_1.setFrameworkParentContext)(api_1.trace.setSpan(api_1.context.active(), rootEntry.otelSpan));
            }
        }
        catch {
            // swallow
        }
    }
    // ------------------------------------------------------------------
    // Lifecycle management
    // ------------------------------------------------------------------
    async forceFlush() {
        try {
            for (const [, { otelSpan }] of this._otelSpans) {
                try {
                    otelSpan.end();
                }
                catch { /* ignore */ }
            }
            this._otelSpans.clear();
            for (const [, { otelSpan }] of this._rootSpans) {
                try {
                    otelSpan.end();
                }
                catch { /* ignore */ }
            }
            this._rootSpans.clear();
            this._traceGroupIds.clear();
        }
        catch {
            // swallow
        }
    }
    async shutdown() {
        await this.forceFlush();
    }
}
exports.OpenLITTracingProcessor = OpenLITTracingProcessor;
//# sourceMappingURL=processor.js.map