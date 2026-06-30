"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PassthroughTracer = exports.OPERATION_MAP = exports.adkWorkflowActive = void 0;
exports.isAdkWorkflowActive = isAdkWorkflowActive;
exports.getOperationType = getOperationType;
exports.getSpanKind = getSpanKind;
exports.generateSpanName = generateSpanName;
exports.resolveModelString = resolveModelString;
exports.extractModelName = extractModelName;
exports.resolveServerInfo = resolveServerInfo;
exports.setCommonSpanAttributes = setCommonSpanAttributes;
exports.captureInputMessages = captureInputMessages;
exports.captureOutputMessages = captureOutputMessages;
exports.captureEventOutput = captureEventOutput;
exports.extractTokenUsage = extractTokenUsage;
exports.enrichLlmSpan = enrichLlmSpan;
exports.enrichToolSpan = enrichToolSpan;
exports.enrichMergedToolSpan = enrichMergedToolSpan;
exports.setRunnerAgentAttributes = setRunnerAgentAttributes;
exports.setAgentAttributes = setAgentAttributes;
exports.processGoogleAdkResponse = processGoogleAdkResponse;
exports.recordGoogleAdkMetrics = recordGoogleAdkMetrics;
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const async_hooks_1 = require("async_hooks");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const config_1 = __importDefault(require("../../config"));
const constant_1 = require("../../constant");
const helpers_1 = require("../../helpers");
/**
 * Prevents Runner.run_async from creating a second invoke_agent span
 * when called internally by Runner.run (mirrors Python _ADK_WORKFLOW_ACTIVE).
 */
exports.adkWorkflowActive = new async_hooks_1.AsyncLocalStorage();
function isAdkWorkflowActive() {
    return exports.adkWorkflowActive.getStore() === true;
}
// ---------------------------------------------------------------------------
// OTel GenAI operation mapping (mirrors Python OPERATION_MAP)
// ---------------------------------------------------------------------------
exports.OPERATION_MAP = {
    agent_init: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
    runner_run_async: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
    runner_run: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
    runner_run_live: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
    agent_run_async: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
};
const SPAN_KIND_MAP = {
    [semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CREATE_AGENT]: api_1.SpanKind.CLIENT,
    [semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK]: api_1.SpanKind.INTERNAL,
    [semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT]: api_1.SpanKind.INTERNAL,
    [semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS]: api_1.SpanKind.INTERNAL,
    [semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT]: api_1.SpanKind.CLIENT,
};
function getOperationType(endpoint) {
    return exports.OPERATION_MAP[endpoint] ?? semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT;
}
function getSpanKind(operationType) {
    return SPAN_KIND_MAP[operationType] ?? api_1.SpanKind.INTERNAL;
}
// ---------------------------------------------------------------------------
// Span name generation (mirrors Python generate_span_name)
// ---------------------------------------------------------------------------
function generateSpanName(endpoint, instance) {
    if (endpoint === 'agent_init') {
        const name = instance?.name ?? 'agent';
        return `create_agent ${name}`;
    }
    if (endpoint === 'runner_run_async' || endpoint === 'runner_run' || endpoint === 'runner_run_live') {
        const appName = instance?.app_name ?? instance?._app_name ?? 'google_adk';
        return `invoke_agent ${appName}`;
    }
    if (endpoint === 'agent_run_async') {
        const name = instance?.name ?? 'agent';
        return `invoke_agent ${name}`;
    }
    return `${getOperationType(endpoint)} ${endpoint}`;
}
// ---------------------------------------------------------------------------
// PassthroughTracer (mirrors Python _PassthroughTracer)
// ---------------------------------------------------------------------------
/**
 * Drop-in replacement for ADK's tracer objects. Overrides
 * `startActiveSpan` to yield the current span instead of creating a new one,
 * letting OpenLIT own top-level spans while ADK's code still runs.
 */
class PassthroughTracer {
    constructor(wrapped) {
        this._wrapped = wrapped;
    }
    startActiveSpan(...args) {
        const fn = args[args.length - 1];
        if (typeof fn === 'function') {
            const currentSpan = api_1.trace.getActiveSpan();
            return fn(currentSpan);
        }
        return undefined;
    }
    startSpan(...args) {
        return this._wrapped.startSpan(...args);
    }
}
exports.PassthroughTracer = PassthroughTracer;
// ---------------------------------------------------------------------------
// Model extraction (mirrors Python _resolve_model_string / extract_model_name)
// ---------------------------------------------------------------------------
function resolveModelString(modelObj) {
    if (typeof modelObj === 'string')
        return modelObj;
    if (!modelObj)
        return null;
    const modelName = modelObj.model_name ?? modelObj.modelName;
    if (typeof modelName === 'string')
        return modelName;
    const inner = modelObj.model;
    if (typeof inner === 'string')
        return inner;
    return null;
}
function extractModelName(instance) {
    try {
        const model = instance?.model;
        if (model) {
            const resolved = resolveModelString(model);
            if (resolved)
                return resolved;
        }
        const rootAgent = instance?.agent;
        if (rootAgent)
            return extractModelName(rootAgent);
    }
    catch { /* ignore */ }
    return 'unknown';
}
// ---------------------------------------------------------------------------
// Server address resolution (mirrors Python resolve_server_info)
// ---------------------------------------------------------------------------
const PREFIX_TO_PROVIDER = {
    anthropic: 'anthropic',
    claude: 'anthropic',
    openai: 'openai',
    gpt: 'openai',
    mistral: 'mistral_ai',
    cohere: 'cohere',
};
function detectProviderFromModelStr(modelStr) {
    if (!modelStr)
        return null;
    const lower = modelStr.toLowerCase();
    const prefix = lower.includes('/') ? lower.split('/')[0] : lower.split('-')[0];
    const providerKey = PREFIX_TO_PROVIDER[prefix];
    if (!providerKey)
        return null;
    const [addr, port] = (0, helpers_1.getServerAddressForProvider)(providerKey);
    if (!addr)
        return null;
    return [addr, port, providerKey];
}
function resolveServerInfo(instance, modelName) {
    if (modelName) {
        const detected = detectProviderFromModelStr(modelName);
        if (detected)
            return detected;
    }
    if (instance) {
        try {
            let modelObj = instance.model;
            if (!modelObj) {
                const agent = instance.agent;
                if (agent)
                    modelObj = agent.model;
            }
            if (modelObj) {
                const resolved = resolveModelString(modelObj);
                if (resolved) {
                    const detected = detectProviderFromModelStr(resolved);
                    if (detected)
                        return detected;
                }
            }
        }
        catch { /* ignore */ }
    }
    const useVertex = (process.env.GOOGLE_GENAI_USE_VERTEXAI || '').toLowerCase();
    if (useVertex === 'true' || useVertex === '1') {
        const [addr, port] = (0, helpers_1.getServerAddressForProvider)('gcp.vertex_ai');
        return [addr, port, 'gcp.vertex_ai'];
    }
    const [addr, port] = (0, helpers_1.getServerAddressForProvider)('gcp.gemini');
    return [addr, port, 'gcp.gemini'];
}
// ---------------------------------------------------------------------------
// Common span attributes (mirrors Python common_framework_span_attributes)
// ---------------------------------------------------------------------------
function setCommonSpanAttributes(span, operationType) {
    span.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, constant_1.SDK_NAME);
    span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment || 'default');
    span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName || 'default');
    span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, constant_1.SDK_VERSION);
    span.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, operationType);
    span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, semantic_convention_1.default.GEN_AI_SYSTEM_GOOGLE_ADK);
}
// ---------------------------------------------------------------------------
// Content extraction helpers (mirrors Python _extract_parts)
// ---------------------------------------------------------------------------
function truncateContent(str, maxLen) {
    const limit = maxLen ?? config_1.default.maxContentLength;
    if (limit && str.length > limit)
        return str.slice(0, limit) + '...';
    return str;
}
function extractParts(parts) {
    const textParts = [];
    const toolCalls = [];
    const toolResponses = [];
    for (const part of parts || []) {
        const text = part?.text;
        if (text)
            textParts.push(truncateContent(String(text)));
        const fc = part?.function_call ?? part?.functionCall;
        if (fc) {
            const entry = {
                name: fc.name ?? '',
                id: fc.id ?? '',
            };
            const fcArgs = fc.args;
            if (fcArgs) {
                try {
                    entry.arguments = typeof fcArgs === 'object' ? JSON.stringify(fcArgs) : String(fcArgs);
                }
                catch {
                    entry.arguments = String(fcArgs);
                }
            }
            toolCalls.push(entry);
        }
        const fr = part?.function_response ?? part?.functionResponse;
        if (fr) {
            const respEntry = {
                name: fr.name ?? '',
                id: fr.id ?? '',
            };
            const frResp = fr.response;
            if (frResp != null) {
                try {
                    respEntry.content = typeof frResp === 'object' ? JSON.stringify(frResp) : String(frResp);
                }
                catch {
                    respEntry.content = String(frResp);
                }
            }
            toolResponses.push(respEntry);
        }
    }
    return { textParts, toolCalls, toolResponses };
}
// ---------------------------------------------------------------------------
// Input/Output message capture (mirrors Python capture_input_messages / capture_output_messages)
// ---------------------------------------------------------------------------
function captureInputMessages(span, llmRequest, captureContent) {
    if (!captureContent)
        return;
    try {
        const contents = llmRequest?.contents;
        if (!contents)
            return;
        const messages = [];
        for (const content of contents.slice(0, 20)) {
            const role = content?.role ?? 'user';
            const rawParts = content?.parts ?? [];
            const { textParts, toolCalls, toolResponses } = extractParts(rawParts);
            const parts = [];
            for (const text of textParts)
                parts.push({ type: 'text', content: text });
            for (const tc of toolCalls) {
                parts.push({ type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments ?? '' });
            }
            for (const tr of toolResponses) {
                parts.push({ type: 'tool_call_response', id: tr.id, response: tr.content ?? '' });
            }
            if (parts.length > 0)
                messages.push({ role: String(role), parts });
        }
        if (messages.length > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, JSON.stringify(messages));
        }
    }
    catch { /* ignore */ }
}
function captureOutputMessages(span, llmResponse, captureContent, finishReason = 'stop') {
    if (!captureContent)
        return;
    try {
        const content = llmResponse?.content;
        if (!content)
            return;
        const rawParts = content.parts ?? [];
        const { textParts, toolCalls } = extractParts(rawParts);
        const parts = [];
        for (const text of textParts)
            parts.push({ type: 'text', content: text });
        for (const tc of toolCalls) {
            parts.push({ type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments ?? '' });
        }
        if (parts.length > 0) {
            const messages = [{ role: 'assistant', parts, finish_reason: finishReason }];
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(messages));
        }
    }
    catch { /* ignore */ }
}
function captureEventOutput(span, event, captureContent) {
    if (!captureContent)
        return;
    try {
        const content = event?.content;
        if (!content)
            return;
        const rawParts = content.parts ?? [];
        const { textParts, toolCalls } = extractParts(rawParts);
        const parts = [];
        for (const text of textParts)
            parts.push({ type: 'text', content: text });
        for (const tc of toolCalls) {
            parts.push({ type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments ?? '' });
        }
        if (parts.length > 0) {
            const messages = [{ role: 'assistant', parts, finish_reason: 'stop' }];
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(messages));
        }
    }
    catch { /* ignore */ }
}
function extractTokenUsage(llmResponse) {
    try {
        const usage = llmResponse?.usage_metadata ?? llmResponse?.usageMetadata;
        if (!usage)
            return {};
        return {
            inputTokens: usage.prompt_token_count ?? usage.promptTokenCount,
            outputTokens: usage.candidates_token_count ?? usage.candidatesTokenCount,
            reasoningTokens: usage.thoughts_token_count ?? usage.thoughtsTokenCount,
            cachedTokens: usage.cached_content_token_count ?? usage.cachedContentTokenCount,
            totalTokens: usage.total_token_count ?? usage.totalTokenCount,
        };
    }
    catch {
        return {};
    }
}
// ---------------------------------------------------------------------------
// Output type detection (mirrors Python _determine_output_type)
// ---------------------------------------------------------------------------
function determineOutputType(llmResponse) {
    try {
        const content = llmResponse?.content;
        if (content) {
            for (const part of (content.parts ?? [])) {
                if (part?.function_call || part?.functionCall)
                    return 'tool_calls';
            }
        }
    }
    catch { /* ignore */ }
    return 'text';
}
// ---------------------------------------------------------------------------
// LLM span enrichment (mirrors Python enrich_llm_span)
// ---------------------------------------------------------------------------
function enrichLlmSpan(span, llmRequest, llmResponse, captureMessageContent) {
    try {
        const requestModel = llmRequest?.model;
        const modelStr = requestModel ? String(requestModel) : null;
        const [serverAddress, serverPort, providerName] = resolveServerInfo(undefined, modelStr);
        span.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT);
        span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, providerName);
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, serverAddress);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, serverPort);
        if (llmRequest) {
            if (modelStr)
                span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, modelStr);
            const config = llmRequest.config;
            if (config) {
                const temp = config.temperature;
                if (temp != null)
                    span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, Number(temp));
                const topP = config.top_p ?? config.topP;
                if (topP != null)
                    span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, Number(topP));
                const maxTokens = config.max_output_tokens ?? config.maxOutputTokens;
                if (maxTokens != null)
                    span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, Number(maxTokens));
            }
            if (captureMessageContent) {
                const sysInstr = config?.system_instruction ?? config?.systemInstruction;
                if (sysInstr) {
                    const instrText = typeof sysInstr === 'string' ? sysInstr : String(sysInstr);
                    span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, JSON.stringify([{ type: 'text', content: truncateContent(instrText) }]));
                }
            }
            captureInputMessages(span, llmRequest, captureMessageContent);
        }
        if (llmResponse) {
            const { inputTokens, outputTokens, reasoningTokens, cachedTokens, totalTokens } = extractTokenUsage(llmResponse);
            if (inputTokens != null)
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
            if (outputTokens != null)
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
            if (reasoningTokens != null)
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_REASONING, reasoningTokens);
            if (cachedTokens != null)
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cachedTokens);
            if (totalTokens != null)
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);
            const responseModel = llmResponse.model_version ?? llmResponse.modelVersion;
            if (responseModel)
                span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, String(responseModel));
            let frStr = 'stop';
            const finishReason = llmResponse.finish_reason ?? llmResponse.finishReason;
            if (finishReason) {
                try {
                    frStr = (typeof finishReason === 'object' && finishReason.value)
                        ? String(finishReason.value).toLowerCase()
                        : String(finishReason).toLowerCase();
                }
                catch {
                    frStr = String(finishReason).toLowerCase();
                }
                span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [frStr]);
            }
            const responseId = llmResponse.response_id ?? llmResponse.responseId ?? llmResponse.id;
            if (responseId)
                span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, String(responseId));
            const errorCode = llmResponse.error_code ?? llmResponse.errorCode;
            if (errorCode) {
                span.setAttribute(semantic_convention_1.default.ERROR_TYPE, String(errorCode));
                const errorMessage = llmResponse.error_message ?? llmResponse.errorMessage;
                if (errorMessage)
                    span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: String(errorMessage) });
            }
            captureOutputMessages(span, llmResponse, captureMessageContent, frStr);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, determineOutputType(llmResponse));
        }
    }
    catch { /* ignore */ }
}
// ---------------------------------------------------------------------------
// ADK Event extraction (mirrors Python _extract_from_event / _is_adk_event)
// ---------------------------------------------------------------------------
function isAdkEvent(obj) {
    if (!obj)
        return false;
    return (obj.constructor?.name === 'Event') && ('content' in obj);
}
function extractFromEvent(eventObj) {
    try {
        const content = eventObj?.content;
        if (!content)
            return [null, null];
        const parts = content.parts;
        if (!parts || parts.length === 0)
            return [null, null];
        const fnResp = parts[0]?.function_response ?? parts[0]?.functionResponse;
        if (!fnResp)
            return [null, null];
        return [fnResp.response ?? null, fnResp.id ?? null];
    }
    catch {
        return [null, null];
    }
}
// ---------------------------------------------------------------------------
// Tool type mapping (mirrors Python _otel_gen_ai_tool_type)
// ---------------------------------------------------------------------------
function otelToolType(tool) {
    const name = tool?.constructor?.name ?? '';
    if (name.includes('Function'))
        return 'function';
    if (name.includes('Agent'))
        return 'extension';
    return 'function';
}
// ---------------------------------------------------------------------------
// Tool span enrichment (mirrors Python enrich_tool_span)
// ---------------------------------------------------------------------------
function enrichToolSpan(span, tool, functionArgs, functionResponseEvent, captureMessageContent, error) {
    try {
        span.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS);
        span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, semantic_convention_1.default.GEN_AI_SYSTEM_GOOGLE_ADK);
        if (tool) {
            const toolName = tool.name ?? tool.constructor?.name ?? 'unknown';
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, String(toolName));
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_TYPE, otelToolType(tool));
            const toolDesc = tool.description;
            if (toolDesc)
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DESCRIPTION, truncateContent(String(toolDesc)));
        }
        let responseDict = null;
        let toolCallId = null;
        if (isAdkEvent(functionResponseEvent)) {
            [responseDict, toolCallId] = extractFromEvent(functionResponseEvent);
        }
        else if (typeof functionResponseEvent === 'object' && functionResponseEvent !== null) {
            responseDict = functionResponseEvent;
            toolCallId = functionResponseEvent.id ?? null;
        }
        if (captureMessageContent) {
            if (functionArgs != null) {
                try {
                    const argsStr = typeof functionArgs === 'object' ? JSON.stringify(functionArgs) : String(functionArgs);
                    span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ARGUMENTS, truncateContent(argsStr));
                }
                catch {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ARGUMENTS, truncateContent(String(functionArgs)));
                }
            }
            if (responseDict != null) {
                try {
                    const resultStr = typeof responseDict === 'object' ? JSON.stringify(responseDict) : String(responseDict);
                    span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_RESULT, truncateContent(resultStr));
                }
                catch {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_RESULT, truncateContent(String(responseDict)));
                }
            }
        }
        if (toolCallId)
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, String(toolCallId));
        if (error != null) {
            const errorType = error.constructor?.name || '_OTHER';
            span.setAttribute(semantic_convention_1.default.ERROR_TYPE, errorType);
            span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: String(error) });
        }
    }
    catch { /* ignore */ }
}
// ---------------------------------------------------------------------------
// Merged tool span enrichment (mirrors Python enrich_merged_tool_span)
// ---------------------------------------------------------------------------
function enrichMergedToolSpan(span, responseEventId, functionResponseEvent, captureMessageContent) {
    try {
        span.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS);
        span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, semantic_convention_1.default.GEN_AI_SYSTEM_GOOGLE_ADK);
        span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, '(merged tools)');
        if (responseEventId)
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, String(responseEventId));
        if (captureMessageContent && functionResponseEvent != null) {
            try {
                const content = functionResponseEvent.content;
                if (content) {
                    const parts = content.parts ?? [];
                    const toolResults = [];
                    for (const part of parts) {
                        const fnResp = part?.function_response ?? part?.functionResponse;
                        if (fnResp) {
                            const entry = {};
                            const name = fnResp.name;
                            if (name)
                                entry.name = String(name);
                            const resp = fnResp.response;
                            if (resp != null)
                                entry.response = resp;
                            if (Object.keys(entry).length > 0)
                                toolResults.push(entry);
                        }
                    }
                    if (toolResults.length > 0) {
                        span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_RESULT, truncateContent(JSON.stringify(toolResults)));
                    }
                }
            }
            catch { /* ignore */ }
        }
    }
    catch { /* ignore */ }
}
// ---------------------------------------------------------------------------
// Runner/Agent attribute setters (mirrors Python _set_runner_agent_attributes / _set_agent_attributes)
// ---------------------------------------------------------------------------
function setRunnerAgentAttributes(span, instance, endpoint) {
    try {
        const appName = instance?.app_name ?? instance?._app_name ?? 'google_adk';
        span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, String(appName));
        if (endpoint === 'runner_run_live') {
            span.setAttribute(semantic_convention_1.default.GEN_AI_EXECUTION_MODE, 'live');
        }
        else if (endpoint === 'runner_run') {
            span.setAttribute(semantic_convention_1.default.GEN_AI_EXECUTION_MODE, 'sync');
        }
        else {
            span.setAttribute(semantic_convention_1.default.GEN_AI_EXECUTION_MODE, 'async');
        }
    }
    catch { /* ignore */ }
}
function setAgentAttributes(span, instance) {
    try {
        const name = instance?.name;
        if (name)
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, String(name));
        const description = instance?.description;
        if (description)
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_DESCRIPTION, String(description));
    }
    catch { /* ignore */ }
}
// ---------------------------------------------------------------------------
// Response processing for Runner/Agent spans (mirrors Python process_google_adk_response)
// ---------------------------------------------------------------------------
function processGoogleAdkResponse(span, endpoint, instance, startTime, _captureMessageContent) {
    const endTime = Date.now();
    const operationType = getOperationType(endpoint);
    const [serverAddress, serverPort] = resolveServerInfo(instance);
    const requestModel = extractModelName(instance);
    setCommonSpanAttributes(span, operationType);
    if (requestModel && requestModel !== 'unknown') {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, requestModel);
    }
    if (serverAddress)
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, serverAddress);
    if (serverPort)
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, serverPort);
    if (endpoint === 'runner_run_async' || endpoint === 'runner_run' || endpoint === 'runner_run_live') {
        setRunnerAgentAttributes(span, instance, endpoint);
    }
    else if (endpoint === 'agent_run_async') {
        setAgentAttributes(span, instance);
    }
    span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
    span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, (endTime - startTime) / 1000);
    (0, helpers_1.applyCustomSpanAttributes)(span);
    span.setStatus({ code: api_1.SpanStatusCode.OK });
}
// ---------------------------------------------------------------------------
// Metrics recording (mirrors Python record_google_adk_metrics)
// ---------------------------------------------------------------------------
function recordGoogleAdkMetrics(operationType, duration, requestModel, serverAddress, serverPort) {
    try {
        const Metrics = require('../../otel/metrics').default;
        const attributes = {
            [semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME]: constant_1.SDK_NAME,
            [semantic_conventions_1.ATTR_SERVICE_NAME]: config_1.default.applicationName || 'default',
            [semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT]: config_1.default.environment || 'default',
            [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
            [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_GOOGLE_ADK,
        };
        if (requestModel && requestModel !== 'unknown') {
            attributes[semantic_convention_1.default.GEN_AI_REQUEST_MODEL] = requestModel;
        }
        if (serverAddress)
            attributes[semantic_convention_1.default.SERVER_ADDRESS] = serverAddress;
        if (serverPort)
            attributes[semantic_convention_1.default.SERVER_PORT] = serverPort;
        if (Metrics.genaiClientOperationDuration) {
            Metrics.genaiClientOperationDuration.record(duration, attributes);
        }
    }
    catch { /* ignore */ }
}
//# sourceMappingURL=utils.js.map