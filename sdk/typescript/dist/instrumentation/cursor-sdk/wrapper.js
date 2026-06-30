"use strict";
/**
 * Cursor SDK wrapper -- OTel GenAI semantic convention compliant.
 *
 * Wraps Agent.create(), Agent.resume(), and agent.send()
 * to produce `create_agent`, `invoke_agent`, and `execute_tool` spans.
 *
 * Agent.prompt() is NOT wrapped separately -- it internally calls
 * create() + send(), so the patched versions handle it automatically
 * without producing duplicate spans.
 *
 * Token usage is captured via onDelta injection (TurnEndedUpdate).
 * Tool call spans are created from SDKMessage stream events.
 * The `system` stream event provides resolved model and tool definitions.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchAgentCreate = patchAgentCreate;
exports.patchAgentResume = patchAgentResume;
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importStar(require("../../helpers"));
const constant_1 = require("../../constant");
const metrics_1 = __importDefault(require("../../otel/metrics"));
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const [SERVER_ADDRESS, SERVER_PORT] = (0, helpers_1.getServerAddressForProvider)('cursor');
const CURSOR_STATUS_TO_FINISH_REASON = {
    finished: 'stop',
    error: 'error',
    cancelled: 'cancelled',
};
class AgentCreationRegistry {
    constructor() {
        this._entries = new WeakMap();
    }
    register(agent, spanContext, options) {
        this._entries.set(agent, { spanContext, options });
    }
    get(agent) {
        return this._entries.get(agent);
    }
}
const agentRegistry = new AgentCreationRegistry();
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function truncateContent(content) {
    const maxLen = config_1.default.maxContentLength;
    if (maxLen != null && maxLen > 0 && content.length > maxLen) {
        return content.slice(0, maxLen);
    }
    return content;
}
function mapRunStatusToFinishReason(status) {
    if (!status)
        return 'stop';
    return CURSOR_STATUS_TO_FINISH_REASON[status] || status;
}
function resolveAgentName(options) {
    if (!options)
        return null;
    const name = options.name;
    if (name && typeof name === 'string' && name.trim())
        return name.trim();
    return null;
}
function resolveModelId(options) {
    if (!options?.model)
        return null;
    const model = options.model;
    if (typeof model === 'string')
        return model;
    if (typeof model === 'object' && model.id)
        return String(model.id);
    return null;
}
/**
 * Stamp `openlit.agent.version_hash` (auto) and `gen_ai.agent.version`
 * (user override, if set) on the span and return the same attributes so
 * the caller can merge them into the inference event extras.
 */
function stampAgentVersion(span, args) {
    const out = {};
    try {
        const versionHash = helpers_1.default.computeAgentVersionHash({
            systemInstructions: args.systemInstructionsJson ?? null,
            toolDefinitions: args.toolDefinitionsJson ?? null,
            primaryModel: args.primaryModel ?? null,
            runtimeConfig: {
                temperature: args.temperature ?? null,
                top_p: args.top_p ?? null,
                max_tokens: args.max_tokens ?? null,
                provider: semantic_convention_1.default.GEN_AI_SYSTEM_CURSOR,
            },
            providers: [semantic_convention_1.default.GEN_AI_SYSTEM_CURSOR],
        });
        if (versionHash) {
            out[semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH] = versionHash;
            span.setAttribute(semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH, versionHash);
        }
    }
    catch {
        // Hash computation must never fail the wrapped call.
    }
    const versionLabel = (0, helpers_1.getCurrentAgentVersion)();
    if (versionLabel) {
        out[semantic_convention_1.default.GEN_AI_AGENT_VERSION] = versionLabel;
        span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_VERSION, versionLabel);
    }
    return out;
}
function setCommonSpanAttributes(span) {
    span.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, constant_1.SDK_NAME);
    span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment ?? 'default');
    span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName ?? 'default');
    span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, constant_1.SDK_VERSION);
    span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, SERVER_ADDRESS);
    span.setAttribute(semantic_convention_1.default.SERVER_PORT, SERVER_PORT);
}
// ---------------------------------------------------------------------------
// Tool span tracker -- manages in-flight execute_tool spans from stream
// ---------------------------------------------------------------------------
class ToolSpanTracker {
    constructor(tracer, parentSpan, captureContent) {
        this._inFlight = new Map();
        this._tracer = tracer;
        this._parentSpan = parentSpan;
        this._captureContent = captureContent;
    }
    startTool(toolName, callId, args) {
        const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS} ${toolName}`;
        const parentCtx = api_1.trace.setSpan(api_1.context.active(), this._parentSpan);
        const span = this._tracer.startSpan(spanName, {
            kind: api_1.SpanKind.INTERNAL,
            attributes: {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS,
                [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_CURSOR,
            },
        }, parentCtx);
        span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, toolName);
        span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, callId);
        span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_TYPE_OTEL, 'extension');
        setCommonSpanAttributes(span);
        if (this._captureContent && args != null) {
            try {
                const argsStr = typeof args === 'string' ? args : JSON.stringify(args);
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ARGUMENTS, truncateContent(argsStr));
            }
            catch { /* ignore */ }
        }
        (0, helpers_1.applyCustomSpanAttributes)(span);
        this._inFlight.set(callId, span);
    }
    endTool(callId, result, isError = false) {
        const span = this._inFlight.get(callId);
        if (!span)
            return;
        this._inFlight.delete(callId);
        if (isError) {
            span.setAttribute(semantic_convention_1.default.ERROR_TYPE, 'ToolExecutionError');
            span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: 'tool execution failed' });
        }
        else {
            if (this._captureContent && result != null) {
                try {
                    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                    span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_RESULT, truncateContent(resultStr));
                }
                catch { /* ignore */ }
            }
            span.setStatus({ code: api_1.SpanStatusCode.OK });
        }
        span.end();
    }
    endAll() {
        for (const [, span] of this._inFlight) {
            span.setStatus({ code: api_1.SpanStatusCode.OK });
            span.end();
        }
        this._inFlight.clear();
    }
}
function processStreamEvent(event, toolTracker, state) {
    if (!event || !event.type)
        return;
    if (!state.runId && event.run_id) {
        state.runId = event.run_id;
    }
    switch (event.type) {
        case 'system': {
            if (event.model) {
                const modelId = typeof event.model === 'string' ? event.model : event.model?.id;
                if (modelId)
                    state.resolvedModel = String(modelId);
            }
            if (Array.isArray(event.tools) && event.tools.length > 0) {
                // Preserve full tool schemas (name/description/parameters) when the
                // SDK provides them; fall back to name-only entries for older
                // versions that emit strings.
                state.toolDefinitions = event.tools.map((tool) => typeof tool === 'string' ? { name: tool } : tool);
            }
            if (typeof event.instructions === 'string' && event.instructions) {
                state.systemInstructions = event.instructions;
            }
            else if (typeof event.systemPrompt === 'string' && event.systemPrompt) {
                state.systemInstructions = event.systemPrompt;
            }
            break;
        }
        case 'tool_call': {
            const callId = event.call_id;
            const toolName = event.name || 'unknown';
            const status = event.status;
            if (status === 'running') {
                toolTracker.startTool(toolName, callId, event.args);
                state.toolCalls.push({ name: toolName, callId, args: event.args });
            }
            else if (status === 'completed') {
                toolTracker.endTool(callId, event.result, false);
                const tc = state.toolCalls.find(t => t.callId === callId);
                if (tc)
                    tc.result = event.result;
            }
            else if (status === 'error') {
                toolTracker.endTool(callId, event.result, true);
            }
            break;
        }
        case 'assistant': {
            if (state.firstContentTimeMs === null) {
                state.firstContentTimeMs = Date.now();
            }
            const content = event.message?.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'text' && block.text) {
                        state.assistantText += block.text;
                    }
                }
            }
            break;
        }
        case 'thinking': {
            if (state.firstContentTimeMs === null) {
                state.firstContentTimeMs = Date.now();
            }
            if (event.text) {
                state.thinkingText += event.text;
            }
            break;
        }
    }
}
// ---------------------------------------------------------------------------
// Build OTel input/output messages
// ---------------------------------------------------------------------------
function buildInputMessages(message) {
    try {
        if (typeof message === 'string') {
            return JSON.stringify([{
                    role: 'user',
                    parts: [{ type: 'text', content: truncateContent(message) }],
                }]);
        }
        const parts = [];
        if (message?.text) {
            parts.push({ type: 'text', content: truncateContent(message.text) });
        }
        if (Array.isArray(message?.images)) {
            for (const img of message.images) {
                parts.push({ type: 'image', mimeType: img.mimeType || 'image/png' });
            }
        }
        if (parts.length === 0)
            return null;
        return JSON.stringify([{ role: 'user', parts }]);
    }
    catch {
        return null;
    }
}
function buildOutputMessages(state, finishReason) {
    try {
        const parts = [];
        if (state.assistantText) {
            parts.push({ type: 'text', content: truncateContent(state.assistantText) });
        }
        if (state.thinkingText) {
            parts.push({ type: 'reasoning', content: truncateContent(state.thinkingText) });
        }
        for (const tc of state.toolCalls) {
            const toolPart = {
                type: 'tool_call',
                id: tc.callId,
                name: tc.name,
            };
            if (tc.args != null) {
                toolPart.arguments = typeof tc.args === 'object' ? tc.args : {};
            }
            parts.push(toolPart);
        }
        if (parts.length === 0)
            return null;
        return JSON.stringify([{ role: 'assistant', parts, finish_reason: finishReason }]);
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// Emit inference event for invoke_agent spans
// ---------------------------------------------------------------------------
function emitInvokeAgentEvent(span, agentId, model, responseModel, finishReason, inputTokens, outputTokens, inputMessagesJson, outputMessagesJson, systemInstructionsJson, toolDefinitionsJson, versionExtras) {
    if (config_1.default.disableEvents)
        return;
    try {
        const attributes = {
            [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
            [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_CURSOR,
            [semantic_convention_1.default.SERVER_ADDRESS]: SERVER_ADDRESS,
            [semantic_convention_1.default.SERVER_PORT]: SERVER_PORT,
        };
        if (model)
            attributes[semantic_convention_1.default.GEN_AI_REQUEST_MODEL] = model;
        if (responseModel)
            attributes[semantic_convention_1.default.GEN_AI_RESPONSE_MODEL] = responseModel;
        if (agentId)
            attributes[semantic_convention_1.default.GEN_AI_CONVERSATION_ID] = agentId;
        if (finishReason)
            attributes[semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON] = [finishReason];
        if (inputTokens)
            attributes[semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS] = inputTokens;
        if (outputTokens)
            attributes[semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS] = outputTokens;
        if (inputMessagesJson != null) {
            attributes[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
        }
        if (outputMessagesJson != null) {
            attributes[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
        }
        if (systemInstructionsJson != null) {
            attributes[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS] = systemInstructionsJson;
        }
        if (toolDefinitionsJson != null) {
            attributes[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS] = toolDefinitionsJson;
        }
        if (versionExtras) {
            Object.assign(attributes, versionExtras);
        }
        helpers_1.default.emitInferenceEvent(span, attributes);
    }
    catch { /* swallow */ }
}
// ---------------------------------------------------------------------------
// Record metrics for invoke_agent spans
// ---------------------------------------------------------------------------
function recordInvokeAgentMetrics(model, inputTokens, outputTokens, cost, duration, errorType) {
    if (config_1.default.disableMetrics)
        return;
    try {
        const attributes = {
            [semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME]: constant_1.SDK_NAME,
            [semantic_conventions_1.ATTR_SERVICE_NAME]: config_1.default.applicationName ?? 'default',
            [semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT]: config_1.default.environment ?? 'default',
            [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_CURSOR,
            [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
            [semantic_convention_1.default.SERVER_ADDRESS]: SERVER_ADDRESS,
            [semantic_convention_1.default.SERVER_PORT]: SERVER_PORT,
        };
        if (model)
            attributes[semantic_convention_1.default.GEN_AI_REQUEST_MODEL] = model;
        if (errorType)
            attributes[semantic_convention_1.default.ERROR_TYPE] = errorType;
        if (metrics_1.default.genaiClientOperationDuration) {
            metrics_1.default.genaiClientOperationDuration.record(duration, attributes);
        }
        if (inputTokens && metrics_1.default.genaiClientUsageTokens) {
            metrics_1.default.genaiClientUsageTokens.record(inputTokens, {
                ...attributes,
                [semantic_convention_1.default.GEN_AI_TOKEN_TYPE]: semantic_convention_1.default.GEN_AI_TOKEN_TYPE_INPUT,
            });
        }
        if (outputTokens && metrics_1.default.genaiClientUsageTokens) {
            metrics_1.default.genaiClientUsageTokens.record(outputTokens, {
                ...attributes,
                [semantic_convention_1.default.GEN_AI_TOKEN_TYPE]: semantic_convention_1.default.GEN_AI_TOKEN_TYPE_OUTPUT,
            });
        }
        if (cost && metrics_1.default.genaiCost) {
            metrics_1.default.genaiCost.record(cost, attributes);
        }
    }
    catch { /* swallow */ }
}
// ---------------------------------------------------------------------------
// wrapSend -- wraps agent.send() to produce invoke_agent spans
// ---------------------------------------------------------------------------
function wrapSend(tracer, originalSend, agentId, agentName, modelId) {
    return function wrappedSend(message, options) {
        const captureContent = config_1.default.captureMessageContent ?? true;
        const displayName = agentName || agentId;
        const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT} ${displayName}`;
        const requestModel = modelId || resolveModelId(options) || 'unknown';
        const creationInfo = agentRegistry.get(this);
        const creationSpanCtx = creationInfo?.spanContext;
        const links = [];
        if (creationSpanCtx) {
            links.push({ context: creationSpanCtx });
        }
        // Start invoke_agent in the same trace as create_agent by using its
        // span context as parent. This keeps both spans in one trace while
        // the span link provides explicit correlation.
        let parentCtx = api_1.context.active();
        if (creationSpanCtx) {
            const remoteSpan = api_1.trace.wrapSpanContext(creationSpanCtx);
            parentCtx = api_1.trace.setSpan(parentCtx, remoteSpan);
        }
        const span = tracer.startSpan(spanName, {
            kind: api_1.SpanKind.CLIENT,
            attributes: {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
                [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_CURSOR,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: SERVER_ADDRESS,
                [semantic_convention_1.default.SERVER_PORT]: SERVER_PORT,
            },
            links,
        }, parentCtx);
        setCommonSpanAttributes(span);
        span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_ID, agentId);
        span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, agentId);
        if (agentName)
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, agentName);
        if (captureContent) {
            const inputJson = buildInputMessages(message);
            if (inputJson)
                span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, inputJson);
        }
        (0, helpers_1.applyCustomSpanAttributes)(span);
        const startTime = Date.now() / 1000;
        const startTimeMs = Date.now();
        const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
        const toolTracker = new ToolSpanTracker(tracer, span, captureContent);
        const streamState = {
            assistantText: '',
            thinkingText: '',
            toolCalls: [],
            resolvedModel: null,
            toolDefinitions: null,
            systemInstructions: null,
            runId: null,
            firstContentTimeMs: null,
        };
        // Seed system_instructions and tool_definitions from `Agent.create` options
        // so they're available before the system stream event arrives.
        const createOptions = creationInfo?.options;
        if (createOptions) {
            const seedInstructions = (typeof createOptions.instructions === 'string' && createOptions.instructions) ||
                (typeof createOptions.systemPrompt === 'string' && createOptions.systemPrompt) ||
                null;
            if (seedInstructions)
                streamState.systemInstructions = seedInstructions;
            if (Array.isArray(createOptions.tools) && createOptions.tools.length > 0) {
                streamState.toolDefinitions = createOptions.tools.slice();
            }
        }
        const userOnDelta = options?.onDelta;
        const mergedOptions = { ...options };
        mergedOptions.onDelta = async (args) => {
            try {
                const update = args?.update;
                if (update?.type === 'turn-ended' && update.usage) {
                    usage.inputTokens += update.usage.inputTokens || 0;
                    usage.outputTokens += update.usage.outputTokens || 0;
                    usage.cacheReadTokens += update.usage.cacheReadTokens || 0;
                    usage.cacheWriteTokens += update.usage.cacheWriteTokens || 0;
                }
            }
            catch { /* swallow */ }
            if (userOnDelta) {
                return userOnDelta(args);
            }
        };
        const spanContext = api_1.trace.setSpan(api_1.context.active(), span);
        (0, helpers_1.setFrameworkLlmActive)();
        let runPromise;
        try {
            runPromise = api_1.context.with(spanContext, () => {
                return originalSend.call(this, message, mergedOptions);
            });
        }
        catch (e) {
            (0, helpers_1.resetFrameworkLlmActive)();
            helpers_1.default.handleException(span, e);
            span.end();
            throw e;
        }
        return runPromise.then((run) => {
            return createRunProxy(run, tracer, span, startTime, startTimeMs, usage, toolTracker, streamState, captureContent, agentId, agentName, requestModel, message);
        }).catch((e) => {
            (0, helpers_1.resetFrameworkLlmActive)();
            helpers_1.default.handleException(span, e);
            recordInvokeAgentMetrics(requestModel, 0, 0, 0, (Date.now() / 1000) - startTime, e?.constructor?.name || '_OTHER');
            span.end();
            throw e;
        });
    };
}
// ---------------------------------------------------------------------------
// createRunProxy -- proxies the Run to intercept stream() and wait()
// ---------------------------------------------------------------------------
function createRunProxy(run, tracer, span, startTime, startTimeMs, usage, toolTracker, streamState, captureContent, agentId, agentName, requestModel, message) {
    let finalized = false;
    let isStreamMode = false;
    const finalizeSpan = (result, error) => {
        if (finalized)
            return;
        finalized = true;
        (0, helpers_1.resetFrameworkLlmActive)();
        toolTracker.endAll();
        const duration = (Date.now() / 1000) - startTime;
        const status = result?.status || run.status || 'finished';
        const finishReason = mapRunStatusToFinishReason(status);
        const responseModel = streamState.resolvedModel || result?.model?.id || run.model?.id || null;
        const durationMs = result?.durationMs || run.durationMs;
        if (responseModel)
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
        const runId = streamState.runId || run.id;
        if (runId)
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, runId);
        if (isStreamMode) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STREAM, true);
        }
        if (usage.inputTokens)
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, usage.inputTokens);
        if (usage.outputTokens)
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, usage.outputTokens);
        if (usage.cacheReadTokens)
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, usage.cacheReadTokens);
        if (usage.cacheWriteTokens)
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, usage.cacheWriteTokens);
        const effectiveDuration = durationMs ? durationMs / 1000 : duration;
        span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, effectiveDuration);
        if (isStreamMode && streamState.firstContentTimeMs !== null) {
            const ttft = (streamState.firstContentTimeMs - startTimeMs) / 1000;
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK, ttft);
        }
        const toolDefinitionsJson = streamState.toolDefinitions
            ? helpers_1.default.buildToolDefinitions(streamState.toolDefinitions)
            : undefined;
        if (toolDefinitionsJson) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
        }
        // Compute system_instructions JSON regardless of captureContent so
        // versions still group correctly when content capture is disabled.
        const systemInstructionsJson = streamState.systemInstructions
            ? JSON.stringify([{ type: 'text', content: streamState.systemInstructions }])
            : undefined;
        if (captureContent && systemInstructionsJson) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstructionsJson);
        }
        const versionExtras = stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: responseModel || requestModel,
            temperature: null,
            top_p: null,
            max_tokens: null,
        });
        const pricingInfo = config_1.default.pricingInfo || {};
        const effectiveModel = responseModel || requestModel;
        const cost = effectiveModel
            ? helpers_1.default.getChatModelCost(effectiveModel, pricingInfo, usage.inputTokens, usage.outputTokens)
            : 0;
        if (cost)
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_COST, cost);
        let outputMessagesJson = null;
        if (captureContent) {
            const resultText = result?.result || run.result;
            if (resultText && !streamState.assistantText) {
                streamState.assistantText = resultText;
            }
            outputMessagesJson = buildOutputMessages(streamState, finishReason);
            if (outputMessagesJson) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
            }
        }
        if (error) {
            helpers_1.default.handleException(span, error instanceof Error ? error : new Error(String(error)));
        }
        else if (status === 'error') {
            span.setAttribute(semantic_convention_1.default.ERROR_TYPE, 'AgentError');
            span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: result?.result || 'agent error' });
        }
        else {
            span.setStatus({ code: api_1.SpanStatusCode.OK });
        }
        const inputMessagesJson = captureContent ? buildInputMessages(message) : null;
        emitInvokeAgentEvent(span, agentId, requestModel, responseModel, finishReason, usage.inputTokens, usage.outputTokens, inputMessagesJson, outputMessagesJson, systemInstructionsJson ?? null, toolDefinitionsJson ?? null, versionExtras);
        recordInvokeAgentMetrics(requestModel, usage.inputTokens, usage.outputTokens, cost, duration, error ? (error.constructor?.name || '_OTHER') : (status === 'error' ? 'AgentError' : undefined));
        span.end();
    };
    return new Proxy(run, {
        get(target, prop, receiver) {
            if (prop === 'stream') {
                const originalStream = target.stream;
                if (typeof originalStream !== 'function')
                    return originalStream;
                return function (...streamArgs) {
                    isStreamMode = true;
                    const generator = originalStream.apply(target, streamArgs);
                    return wrapAsyncGenerator(generator, toolTracker, streamState, finalizeSpan);
                };
            }
            if (prop === 'wait') {
                const originalWait = target.wait;
                if (typeof originalWait !== 'function')
                    return originalWait;
                return function (...waitArgs) {
                    return originalWait.apply(target, waitArgs).then((result) => {
                        finalizeSpan(result);
                        return result;
                    }).catch((e) => {
                        finalizeSpan(undefined, e);
                        throw e;
                    });
                };
            }
            if (prop === 'cancel') {
                const originalCancel = target.cancel;
                if (typeof originalCancel !== 'function')
                    return originalCancel;
                return function (...cancelArgs) {
                    return originalCancel.apply(target, cancelArgs).then((result) => {
                        finalizeSpan({ status: 'cancelled' });
                        return result;
                    });
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}
// ---------------------------------------------------------------------------
// wrapAsyncGenerator -- wraps run.stream() to intercept SDKMessage events
// ---------------------------------------------------------------------------
async function* wrapAsyncGenerator(generator, toolTracker, streamState, finalizeSpan) {
    try {
        for await (const event of generator) {
            try {
                processStreamEvent(event, toolTracker, streamState);
            }
            catch { /* swallow processing errors */ }
            yield event;
        }
        finalizeSpan();
    }
    catch (e) {
        finalizeSpan(undefined, e);
        throw e;
    }
}
// ---------------------------------------------------------------------------
// patchAgentCreate -- wraps Agent.create() for create_agent spans
// ---------------------------------------------------------------------------
function patchAgentCreate(tracer) {
    return (originalCreate) => {
        return async function wrappedCreate(options) {
            const agentName = resolveAgentName(options);
            const modelId = resolveModelId(options);
            const displayName = agentName || 'cursor-agent';
            const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CREATE_AGENT} ${displayName}`;
            const span = tracer.startSpan(spanName, {
                kind: api_1.SpanKind.CLIENT,
                attributes: {
                    [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
                    [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_CURSOR,
                    [semantic_convention_1.default.SERVER_ADDRESS]: SERVER_ADDRESS,
                    [semantic_convention_1.default.SERVER_PORT]: SERVER_PORT,
                },
            });
            setCommonSpanAttributes(span);
            if (agentName)
                span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, agentName);
            if (modelId)
                span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, modelId);
            const captureContent = config_1.default.captureMessageContent ?? true;
            const instructionsText = (options && typeof options.instructions === 'string' && options.instructions) ||
                (options && typeof options.systemPrompt === 'string' && options.systemPrompt) ||
                null;
            if (captureContent && instructionsText) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, JSON.stringify([{ type: 'text', content: instructionsText }]));
            }
            const optionTools = Array.isArray(options?.tools) ? options.tools : undefined;
            const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(optionTools);
            if (toolDefinitionsJson) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
            }
            (0, helpers_1.applyCustomSpanAttributes)(span);
            try {
                const agent = await originalCreate.call(this, options);
                const agentId = agent.agentId;
                if (agentId) {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_ID, agentId);
                }
                agentRegistry.register(agent, span.spanContext(), options);
                const resolvedModel = agent.model?.id || modelId;
                if (resolvedModel)
                    span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, resolvedModel);
                span.setStatus({ code: api_1.SpanStatusCode.OK });
                span.end();
                if (typeof agent.send === 'function') {
                    const originalAgentSend = agent.send.bind(agent);
                    agent.send = wrapSend(tracer, originalAgentSend, agentId, agentName, resolvedModel);
                }
                return agent;
            }
            catch (e) {
                helpers_1.default.handleException(span, e);
                span.end();
                throw e;
            }
        };
    };
}
// ---------------------------------------------------------------------------
// patchAgentResume -- wraps Agent.resume() to patch send() on resumed agents
// ---------------------------------------------------------------------------
function patchAgentResume(tracer) {
    return (originalResume) => {
        return async function wrappedResume(agentId, options) {
            const agentName = resolveAgentName(options);
            const modelId = resolveModelId(options);
            const agent = await originalResume.call(this, agentId, options);
            const resolvedAgentId = agent.agentId || agentId;
            const resolvedModel = agent.model?.id || modelId;
            if (typeof agent.send === 'function') {
                const originalAgentSend = agent.send.bind(agent);
                agent.send = wrapSend(tracer, originalAgentSend, resolvedAgentId, agentName, resolvedModel);
            }
            return agent;
        };
    };
}
//# sourceMappingURL=wrapper.js.map