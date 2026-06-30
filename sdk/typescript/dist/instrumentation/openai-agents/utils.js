"use strict";
/**
 * OpenAI Agents utilities for OTel GenAI semantic convention compliant telemetry.
 *
 * Maps SDK span types to OTel operation names, determines SpanKind,
 * generates span names, and sets type-specific attributes on OTel spans.
 *
 * All attribute setting happens at on_span_end (when span data is fully
 * populated), matching the Python SDK pattern.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOperationType = getOperationType;
exports.getSpanKind = getSpanKind;
exports.generateSpanName = generateSpanName;
exports.processSpanEnd = processSpanEnd;
exports.recordMetrics = recordMetrics;
exports.extractModelFromSpanData = extractModelFromSpanData;
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const constant_1 = require("../../constant");
const config_1 = __importDefault(require("../../config"));
const metrics_1 = __importDefault(require("../../otel/metrics"));
const helpers_1 = require("../../helpers");
const [OPENAI_SERVER_ADDRESS, OPENAI_SERVER_PORT] = (0, helpers_1.getServerAddressForProvider)('openai');
// SDK span_data.type -> gen_ai.operation.name
const OPERATION_MAP = {
    agent: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
    generation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
    response: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
    function: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS,
    handoff: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
    guardrail: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
    custom: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
    transcription: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
    speech: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
    speech_group: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    mcp_tools: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS,
};
// SpanKind per operation (OTel GenAI spec)
const SPAN_KIND_MAP = {
    [semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK]: api_1.SpanKind.INTERNAL,
    [semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT]: api_1.SpanKind.INTERNAL,
    [semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS]: api_1.SpanKind.INTERNAL,
    [semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT]: api_1.SpanKind.CLIENT,
};
const MAX_HANDOFFS = 1000;
function getOperationType(spanType) {
    return OPERATION_MAP[spanType] ?? semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT;
}
function getSpanKind(operationType) {
    return SPAN_KIND_MAP[operationType] ?? api_1.SpanKind.INTERNAL;
}
function generateSpanName(spanData) {
    const spanType = spanData?.type ?? 'unknown';
    const operation = getOperationType(spanType);
    if (spanType === 'agent') {
        const name = spanData.name ?? 'agent';
        return `${operation} ${name}`;
    }
    if (spanType === 'generation' || spanType === 'response') {
        const model = extractModelFromSpanData(spanData);
        return model ? `${operation} ${model}` : operation;
    }
    if (spanType === 'function') {
        const name = spanData.name ?? 'function';
        return `${operation} ${name}`;
    }
    if (spanType === 'handoff') {
        const toAgent = spanData.toAgent ?? spanData.to_agent ?? 'unknown';
        return `${operation} ${toAgent}`;
    }
    if (spanType === 'guardrail') {
        const name = spanData.name ?? 'guardrail';
        return `${operation} ${name}`;
    }
    if (spanType === 'mcp_tools') {
        return `${operation} mcp_list_tools`;
    }
    if (spanType === 'transcription')
        return `${operation} transcription`;
    if (spanType === 'speech')
        return `${operation} speech`;
    if (spanType === 'speech_group')
        return `${operation} speech_group`;
    if (spanType === 'custom') {
        const name = spanData.name ?? 'custom';
        return `${operation} ${name}`;
    }
    return operation;
}
/**
 * Set all OTel-compliant attributes on the OTel span using fully-populated SDK data.
 * Called from on_span_end in the processor.
 */
function processSpanEnd(otelSpan, sdkSpan, startTime, conversationId, handoffTracker) {
    try {
        const endTime = Date.now();
        const spanData = sdkSpan.spanData;
        const spanType = spanData?.type ?? 'unknown';
        const operation = getOperationType(spanType);
        const modelName = extractModelFromSpanData(spanData);
        const updatedName = generateSpanName(spanData);
        try {
            otelSpan.updateName(updatedName);
        }
        catch {
            // updateName may not be available on all span implementations
        }
        setCommonFrameworkAttributes(otelSpan, operation, modelName, endTime - startTime);
        otelSpan.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, operation);
        otelSpan.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, semantic_convention_1.default.GEN_AI_SYSTEM_OPENAI);
        if (conversationId) {
            otelSpan.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, conversationId);
        }
        if (modelName) {
            otelSpan.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, modelName);
        }
        // Dispatch to type-specific handler
        const captureContent = config_1.default.captureMessageContent ?? true;
        if (spanType === 'agent') {
            setAgentAttributes(otelSpan, spanData, captureContent);
        }
        else if (spanType === 'response') {
            setResponseAttributes(otelSpan, spanData, captureContent);
        }
        else if (spanType === 'generation') {
            setGenerationAttributes(otelSpan, spanData, captureContent);
        }
        else if (spanType === 'function') {
            setFunctionAttributes(otelSpan, spanData, captureContent);
        }
        else if (spanType === 'handoff') {
            setHandoffAttributes(otelSpan, spanData, handoffTracker, sdkSpan.traceId ?? '');
        }
        else if (spanType === 'guardrail') {
            setGuardrailAttributes(otelSpan, spanData);
        }
        else if (spanType === 'transcription') {
            setTranscriptionAttributes(otelSpan, spanData, captureContent);
        }
        else if (spanType === 'speech') {
            setSpeechAttributes(otelSpan, spanData, captureContent);
        }
        else if (spanType === 'mcp_tools') {
            setMcpToolsAttributes(otelSpan, spanData);
        }
        else if (spanType === 'custom') {
            setCustomAttributes(otelSpan, spanData);
        }
        // Error handling
        const error = sdkSpan.error;
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
            recordMetrics(operation, (endTime - startTime) / 1000, modelName);
        }
    }
    catch {
        // Swallow to avoid breaking the agent run
    }
}
// ---------------------------------------------------------------------------
// Common framework span attributes (mirrors Python common_framework_span_attributes)
// ---------------------------------------------------------------------------
function setCommonFrameworkAttributes(span, operation, modelName, durationMs) {
    span.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, constant_1.SDK_NAME);
    span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, constant_1.SDK_VERSION);
    span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, semantic_convention_1.default.GEN_AI_SYSTEM_OPENAI);
    span.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, operation);
    if (modelName) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, modelName);
    }
    if (OPENAI_SERVER_ADDRESS) {
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
        if (OPENAI_SERVER_PORT) {
            span.setAttribute(semantic_convention_1.default.SERVER_PORT, OPENAI_SERVER_PORT);
        }
    }
    span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment ?? 'default');
    span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName ?? 'default');
    span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, durationMs / 1000);
    (0, helpers_1.applyCustomSpanAttributes)(span);
}
// ---------------------------------------------------------------------------
// Agent (invoke_agent)
// ---------------------------------------------------------------------------
function setAgentAttributes(span, spanData, captureContent) {
    try {
        const name = spanData.name;
        if (name) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, String(name));
        }
        const agentId = spanData.agentId ?? spanData.agent_id;
        if (agentId && typeof agentId === 'string') {
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_ID, agentId);
        }
        const outputType = spanData.outputType ?? spanData.output_type;
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, mapOutputType(outputType));
        if (captureContent) {
            const tools = spanData.tools;
            if (tools && tools.length > 0) {
                const toolDefs = tools.slice(0, 20).map((t) => ({
                    type: 'function',
                    name: String(typeof t === 'string' ? t : t),
                }));
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, JSON.stringify(toolDefs));
            }
            const handoffs = spanData.handoffs;
            if (handoffs && handoffs.length > 0) {
                span.setAttribute('gen_ai.agent.handoffs', JSON.stringify(handoffs.slice(0, 20).map(String)));
            }
        }
    }
    catch {
        // swallow
    }
}
// ---------------------------------------------------------------------------
// Response (chat -- Response API)
// ---------------------------------------------------------------------------
function setResponseAttributes(span, spanData, captureContent) {
    try {
        const response = spanData.response;
        if (!response)
            return;
        const model = response.model;
        if (model) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, String(model));
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, String(model));
        }
        const respId = response.id;
        if (respId) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, String(respId));
        }
        const usage = response.usage;
        if (usage) {
            const inputTokens = usage.input_tokens ?? usage.inputTokens;
            const outputTokens = usage.output_tokens ?? usage.outputTokens;
            if (inputTokens != null) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
            }
            if (outputTokens != null) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
            }
        }
        const outputItems = response.output;
        if (Array.isArray(outputItems)) {
            const finishReasons = [];
            for (const item of outputItems) {
                const status = item.status;
                if (status)
                    finishReasons.push(String(status));
            }
            if (finishReasons.length > 0) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, finishReasons);
            }
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, OPENAI_SERVER_PORT);
        if (captureContent) {
            captureResponseMessages(span, spanData, response);
        }
    }
    catch {
        // swallow
    }
}
function captureResponseMessages(span, spanData, response) {
    try {
        const rawInput = spanData.input;
        if (rawInput) {
            let messages;
            if (typeof rawInput === 'string') {
                messages = [formatInputMessage('user', rawInput)];
            }
            else if (Array.isArray(rawInput)) {
                messages = [];
                for (const item of rawInput.slice(0, 20)) {
                    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                        if (item.role) {
                            messages.push(item);
                        }
                        else {
                            messages.push(formatInputMessage('user', item));
                        }
                    }
                    else {
                        const role = String(item?.role ?? 'user');
                        const content = item?.content ?? String(item);
                        messages.push(formatInputMessage(role, content));
                    }
                }
            }
            else {
                messages = [formatInputMessage('user', rawInput)];
            }
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, JSON.stringify(messages));
        }
        const outputItems = response.output;
        if (Array.isArray(outputItems)) {
            const outMessages = [];
            for (const item of outputItems.slice(0, 20)) {
                const itemType = item.type;
                if (itemType === 'message') {
                    const contentParts = item.content ?? [];
                    const textParts = [];
                    for (const part of contentParts) {
                        const text = part.text;
                        if (text)
                            textParts.push(String(text));
                    }
                    if (textParts.length > 0) {
                        outMessages.push(formatOutputMessage(textParts.join(' ')));
                    }
                }
                else if (itemType === 'function_call') {
                    outMessages.push({
                        role: 'assistant',
                        parts: [
                            {
                                type: 'tool_call',
                                name: item.name ?? 'unknown',
                                arguments: item.arguments ?? '',
                            },
                        ],
                    });
                }
            }
            if (outMessages.length > 0) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(outMessages));
            }
        }
    }
    catch {
        // swallow
    }
}
// ---------------------------------------------------------------------------
// Generation (chat -- Chat Completions API)
// ---------------------------------------------------------------------------
function setGenerationAttributes(span, spanData, captureContent) {
    try {
        const model = spanData.model;
        if (model) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, String(model));
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, String(model));
        }
        const usage = spanData.usage;
        if (usage && typeof usage === 'object') {
            const inputTokens = usage.input_tokens ?? usage.inputTokens;
            const outputTokens = usage.output_tokens ?? usage.outputTokens;
            if (inputTokens != null) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
            }
            if (outputTokens != null) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
            }
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, OPENAI_SERVER_PORT);
        if (captureContent) {
            const rawInput = spanData.input;
            if (rawInput) {
                if (Array.isArray(rawInput)) {
                    const messages = rawInput.slice(0, 20).map((msg) => typeof msg === 'object' && msg !== null ? msg : formatInputMessage('user', msg));
                    span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, JSON.stringify(messages));
                }
                else {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, JSON.stringify([formatInputMessage('user', rawInput)]));
                }
            }
            const rawOutput = spanData.output;
            if (rawOutput) {
                if (Array.isArray(rawOutput)) {
                    const messages = rawOutput.slice(0, 20).map((msg) => typeof msg === 'object' && msg !== null ? msg : formatOutputMessage(msg));
                    span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(messages));
                }
                else {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, JSON.stringify([formatOutputMessage(rawOutput)]));
                }
            }
        }
    }
    catch {
        // swallow
    }
}
// ---------------------------------------------------------------------------
// Function / Tool (execute_tool)
// ---------------------------------------------------------------------------
function setFunctionAttributes(span, spanData, captureContent) {
    try {
        const name = spanData.name;
        if (name) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, String(name));
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_TYPE, 'function');
        if (captureContent) {
            const toolInput = spanData.input;
            if (toolInput != null) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ARGUMENTS, String(toolInput));
            }
            const toolOutput = spanData.output;
            if (toolOutput != null) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_RESULT, String(toolOutput));
            }
        }
    }
    catch {
        // swallow
    }
}
// ---------------------------------------------------------------------------
// Handoff (invoke_agent for target)
// ---------------------------------------------------------------------------
function setHandoffAttributes(span, spanData, handoffTracker, traceId) {
    try {
        const toAgent = spanData.toAgent ?? spanData.to_agent;
        const fromAgent = spanData.fromAgent ?? spanData.from_agent;
        if (toAgent) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, String(toAgent));
            const key = `${toAgent}:${traceId}`;
            handoffTracker.set(key, fromAgent ? String(fromAgent) : 'unknown');
            if (handoffTracker.size > MAX_HANDOFFS) {
                const firstKey = handoffTracker.keys().next().value;
                if (firstKey !== undefined)
                    handoffTracker.delete(firstKey);
            }
        }
        if (fromAgent) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_SOURCE, String(fromAgent));
        }
    }
    catch {
        // swallow
    }
}
// ---------------------------------------------------------------------------
// Guardrail (invoke_agent)
// ---------------------------------------------------------------------------
function setGuardrailAttributes(span, spanData) {
    try {
        const name = spanData.name;
        if (name) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, String(name));
        }
        const triggered = spanData.triggered;
        if (triggered != null) {
            span.setAttribute('gen_ai.guardrail.triggered', Boolean(triggered));
        }
    }
    catch {
        // swallow
    }
}
// ---------------------------------------------------------------------------
// Transcription (chat)
// ---------------------------------------------------------------------------
function setTranscriptionAttributes(span, spanData, captureContent) {
    try {
        const model = spanData.model;
        if (model) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, String(model));
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, String(model));
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, OPENAI_SERVER_PORT);
        if (captureContent) {
            const output = spanData.output;
            if (output) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, JSON.stringify([formatOutputMessage(output)]));
            }
        }
    }
    catch {
        // swallow
    }
}
// ---------------------------------------------------------------------------
// Speech (chat)
// ---------------------------------------------------------------------------
function setSpeechAttributes(span, spanData, captureContent) {
    try {
        const model = spanData.model;
        if (model) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, String(model));
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, String(model));
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, 'speech');
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, OPENAI_SERVER_PORT);
        if (captureContent) {
            const textInput = spanData.input;
            if (textInput) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, JSON.stringify([formatInputMessage('user', textInput)]));
            }
        }
    }
    catch {
        // swallow
    }
}
// ---------------------------------------------------------------------------
// MCP List Tools (execute_tool)
// ---------------------------------------------------------------------------
function setMcpToolsAttributes(span, spanData) {
    try {
        span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, 'mcp_list_tools');
        span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_TYPE, 'function');
        const server = spanData.server;
        if (server) {
            span.setAttribute('gen_ai.mcp.server', String(server));
        }
        const result = spanData.result;
        if (result) {
            const items = Array.isArray(result) ? result.slice(0, 50) : result;
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_RESULT, JSON.stringify(items));
        }
    }
    catch {
        // swallow
    }
}
// ---------------------------------------------------------------------------
// Custom (invoke_agent)
// ---------------------------------------------------------------------------
function setCustomAttributes(span, spanData) {
    try {
        const name = spanData.name;
        if (name) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, String(name));
        }
        const data = spanData.data;
        if (data && typeof data === 'object') {
            try {
                span.setAttribute('gen_ai.custom.data', JSON.stringify(data));
            }
            catch {
                // non-serialisable data
            }
        }
    }
    catch {
        // swallow
    }
}
// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
function recordMetrics(operationType, durationSeconds, requestModel) {
    try {
        const attributes = {
            [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
            [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_OPENAI,
            [semantic_conventions_1.ATTR_SERVICE_NAME]: config_1.default.applicationName ?? 'default',
            [semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT]: config_1.default.environment ?? 'default',
        };
        if (requestModel) {
            attributes[semantic_convention_1.default.GEN_AI_REQUEST_MODEL] = requestModel;
        }
        if (OPENAI_SERVER_ADDRESS) {
            attributes[semantic_convention_1.default.SERVER_ADDRESS] = OPENAI_SERVER_ADDRESS;
        }
        if (OPENAI_SERVER_PORT) {
            attributes[semantic_convention_1.default.SERVER_PORT] = OPENAI_SERVER_PORT;
        }
        metrics_1.default.genaiClientOperationDuration?.record(durationSeconds, attributes);
    }
    catch {
        // swallow
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function extractModelFromSpanData(spanData) {
    const model = spanData?.model;
    if (model)
        return String(model);
    const response = spanData?.response;
    if (response) {
        const rModel = response.model;
        if (rModel)
            return String(rModel);
    }
    return null;
}
function mapOutputType(outputType) {
    if (outputType == null)
        return semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT;
    const s = String(outputType).toLowerCase();
    if (s.includes('dict') || s.includes('json'))
        return semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON;
    return semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT;
}
function formatInputMessage(role, content) {
    return { role, parts: [{ type: 'text', content: String(content) }] };
}
function formatOutputMessage(content) {
    return {
        role: 'assistant',
        parts: [{ type: 'text', content: String(content) }],
    };
}
//# sourceMappingURL=utils.js.map