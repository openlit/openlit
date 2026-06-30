"use strict";
/**
 * Claude Agent SDK wrapper — OTel GenAI semantic convention compliant.
 *
 * Wraps the `query()` async generator to produce `invoke_agent`, `execute_tool`,
 * and `chat` child spans. Tool spans are created via SDK hooks (PreToolUse /
 * PostToolUse / PostToolUseFailure). A message-based fallback handles cases
 * where hooks cannot be injected.
 *
 * Mirrors the Python SDK instrumentation in
 * sdk/python/src/openlit/instrumentation/claude_agent_sdk/.
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
exports.patchQuery = patchQuery;
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
const [SERVER_ADDRESS, SERVER_PORT] = (0, helpers_1.getServerAddressForProvider)('anthropic');
const GEN_AI_SYSTEM_ATTR = 'gen_ai.system';
const GEN_AI_SYSTEM_VALUE = 'anthropic';
const ANTHROPIC_FINISH_REASON_MAP = {
    end_turn: 'stop',
    max_tokens: 'length',
    stop_sequence: 'stop',
    tool_use: 'tool_call',
};
const OPERATION_MAP = {
    query: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
    execute_tool: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS,
    subagent: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
    chat: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
    create_agent: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
};
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
function mapFinishReason(rawReason) {
    if (!rawReason)
        return 'stop';
    return ANTHROPIC_FINISH_REASON_MAP[rawReason] || rawReason;
}
function resolveAgentName(options) {
    if (!options)
        return null;
    for (const key of ['agent_name', 'agentName', 'name']) {
        const val = options[key];
        if (val && typeof val === 'string' && val.trim())
            return val.trim();
    }
    return null;
}
function generateSpanName(endpoint, entityName) {
    const operation = OPERATION_MAP[endpoint] || semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT;
    if (entityName)
        return `${operation} ${entityName}`;
    return operation;
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
                provider: semantic_convention_1.default.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
            },
            providers: [semantic_convention_1.default.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK],
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
function extractUsage(usage) {
    const attrs = {};
    if (!usage)
        return attrs;
    const rawInput = parseInt(usage.input_tokens, 10) || 0;
    const outputTokens = parseInt(usage.output_tokens, 10);
    if (!isNaN(outputTokens)) {
        attrs[semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS] = outputTokens;
    }
    let cacheReadInt = 0;
    const cacheRead = usage.cache_read_input_tokens;
    if (cacheRead != null) {
        cacheReadInt = parseInt(cacheRead, 10) || 0;
        if (cacheReadInt) {
            attrs[semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] = cacheReadInt;
        }
    }
    let cacheCreationInt = 0;
    const cacheCreation = usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens;
    if (cacheCreation != null) {
        cacheCreationInt = parseInt(cacheCreation, 10) || 0;
        if (cacheCreationInt) {
            attrs[semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] = cacheCreationInt;
        }
    }
    attrs[semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS] = rawInput + cacheReadInt + cacheCreationInt;
    return attrs;
}
// ---------------------------------------------------------------------------
// ToolSpanTracker — manages in-flight tool spans created by SDK hooks
// ---------------------------------------------------------------------------
class ToolSpanTracker {
    constructor(tracer, parentSpan, captureContent) {
        this._inFlight = new Map();
        this._completed = new Set();
        this._tracer = tracer;
        this._parentSpan = parentSpan;
        this._captureContent = captureContent;
    }
    startTool(toolName, toolInput, toolUseId) {
        const spanName = generateSpanName('execute_tool', toolName);
        const parentCtx = api_1.trace.setSpan(api_1.context.active(), this._parentSpan);
        const span = this._tracer.startSpan(spanName, {
            kind: api_1.SpanKind.INTERNAL,
            attributes: {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS,
                [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
            },
        }, parentCtx);
        setToolSpanAttributes(span, toolName, toolInput, toolUseId, this._captureContent);
        this._inFlight.set(toolUseId, span);
    }
    endTool(toolUseId, toolResponse) {
        const span = this._inFlight.get(toolUseId);
        if (!span)
            return;
        this._inFlight.delete(toolUseId);
        finalizeToolSpan(span, toolResponse, this._captureContent);
        span.end();
        this._completed.add(toolUseId);
    }
    endToolError(toolUseId, error) {
        const span = this._inFlight.get(toolUseId);
        if (!span)
            return;
        this._inFlight.delete(toolUseId);
        finalizeToolSpan(span, null, this._captureContent, true, error);
        span.end();
        this._completed.add(toolUseId);
    }
    endAll() {
        for (const [_toolUseId, span] of this._inFlight) {
            finalizeToolSpan(span, null, this._captureContent, true, 'abandoned');
            span.end();
        }
        this._inFlight.clear();
    }
}
// ---------------------------------------------------------------------------
// SubagentSpanTracker — manages subagent spans for Task tool
// ---------------------------------------------------------------------------
class SubagentSpanTracker {
    constructor(tracer, toolTracker) {
        this._inFlight = new Map();
        this._toolUseToTask = new Map();
        this._tracer = tracer;
        this._toolTracker = toolTracker;
    }
    startSubagent(taskId, description, toolUseId) {
        const name = description || taskId || 'subagent';
        const spanName = generateSpanName('subagent', name);
        if (toolUseId) {
            this._toolUseToTask.set(toolUseId, taskId);
        }
        let parentSpan;
        if (toolUseId) {
            parentSpan = this._toolTracker._inFlight.get(toolUseId);
        }
        const ctx = parentSpan ? api_1.trace.setSpan(api_1.context.active(), parentSpan) : undefined;
        const span = this._tracer.startSpan(spanName, {
            kind: api_1.SpanKind.INTERNAL,
            attributes: {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
                [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
            },
        }, ctx);
        span.setAttribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE);
        span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, String(name));
        span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment ?? 'default');
        span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName ?? 'default');
        span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, constant_1.SDK_VERSION);
        this._inFlight.set(taskId, span);
    }
    endSubagent(taskId, isError = false, errorMessage, usage) {
        const span = this._inFlight.get(taskId);
        if (!span)
            return;
        this._inFlight.delete(taskId);
        if (usage) {
            if (usage.total_tokens != null) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, Number(usage.total_tokens) || 0);
            }
            if (usage.tool_uses != null) {
                span.setAttribute('gen_ai.agent.tool_uses', Number(usage.tool_uses) || 0);
            }
            if (usage.duration_ms != null) {
                span.setAttribute('gen_ai.agent.duration_ms', Number(usage.duration_ms) || 0);
            }
        }
        if (isError) {
            const err = errorMessage ? String(errorMessage) : 'task failed';
            span.setAttribute(semantic_convention_1.default.ERROR_TYPE, 'SubagentError');
            span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: err });
        }
        else {
            span.setStatus({ code: api_1.SpanStatusCode.OK });
        }
        span.end();
    }
    getSpanForToolUseId(toolUseId) {
        const taskId = this._toolUseToTask.get(toolUseId);
        return taskId ? this._inFlight.get(taskId) : undefined;
    }
    endAll() {
        for (const taskId of this._inFlight.keys()) {
            this.endSubagent(taskId, true, 'abandoned');
        }
    }
}
// ---------------------------------------------------------------------------
// Tool span attributes
// ---------------------------------------------------------------------------
function setToolSpanAttributes(span, toolName, toolInput, toolUseId, captureContent) {
    span.setAttribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE);
    span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, String(toolName));
    const toolType = String(toolName).startsWith('mcp__') ? 'extension' : 'function';
    span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_TYPE, toolType);
    if (toolUseId) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, String(toolUseId));
    }
    span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, SERVER_ADDRESS);
    span.setAttribute(semantic_convention_1.default.SERVER_PORT, SERVER_PORT);
    span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment ?? 'default');
    span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName ?? 'default');
    span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, constant_1.SDK_VERSION);
    if (captureContent && toolInput != null) {
        try {
            const argsStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ARGUMENTS, truncateContent(argsStr));
        }
        catch { /* ignore */ }
    }
    (0, helpers_1.applyCustomSpanAttributes)(span);
}
function finalizeToolSpan(span, toolResponse, captureContent, isError = false, errorMessage) {
    if (isError) {
        const errMsg = errorMessage ? String(errorMessage) : 'tool execution failed';
        span.setAttribute(semantic_convention_1.default.ERROR_TYPE, 'ToolExecutionError');
        span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: errMsg });
    }
    else {
        if (captureContent && toolResponse != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_RESULT, truncateContent(String(toolResponse)));
        }
        span.setStatus({ code: api_1.SpanStatusCode.OK });
    }
}
// ---------------------------------------------------------------------------
// Hook injection — merges OpenLIT hooks into user-provided options
// ---------------------------------------------------------------------------
function injectHooks(options, toolTracker, subagentTracker) {
    if (!options.hooks) {
        options.hooks = {};
    }
    const preToolUse = async (input, toolUseId) => {
        try {
            const toolName = input.tool_name || 'unknown';
            const toolInput = input.tool_input;
            const id = toolUseId || input.tool_use_id;
            if (id)
                toolTracker.startTool(toolName, toolInput, id);
        }
        catch { /* swallow */ }
        return {};
    };
    const postToolUse = async (input, toolUseId) => {
        try {
            const toolResponse = input.tool_response;
            const id = toolUseId || input.tool_use_id;
            if (id)
                toolTracker.endTool(id, toolResponse);
        }
        catch { /* swallow */ }
        return {};
    };
    const postToolUseFailure = async (input, toolUseId) => {
        try {
            const error = input.error || 'unknown error';
            const id = toolUseId || input.tool_use_id;
            if (id)
                toolTracker.endToolError(id, error);
        }
        catch { /* swallow */ }
        return {};
    };
    const subagentStart = async (input, toolUseId) => {
        try {
            const agentId = input.agent_id;
            if (agentId) {
                const description = input.description || agentId;
                subagentTracker.startSubagent(agentId, description, toolUseId ?? undefined);
            }
        }
        catch { /* swallow */ }
        return {};
    };
    const subagentStop = async (input) => {
        try {
            const agentId = input.agent_id;
            if (!agentId)
                return {};
            const error = input.error;
            subagentTracker.endSubagent(agentId, !!error, error);
        }
        catch { /* swallow */ }
        return {};
    };
    const hookPairs = [
        ['PreToolUse', preToolUse],
        ['PostToolUse', postToolUse],
        ['PostToolUseFailure', postToolUseFailure],
        ['SubagentStart', subagentStart],
        ['SubagentStop', subagentStop],
    ];
    for (const [event, callback] of hookPairs) {
        const matcher = { hooks: [callback] };
        if (options.hooks[event]) {
            options.hooks[event].push(matcher);
        }
        else {
            options.hooks[event] = [matcher];
        }
    }
}
function hasLlmCallData(msg) {
    return msg.message?.model != null && msg.message?.usage != null;
}
function bufferChatMessage(sdkMsg, chatState) {
    if (!hasLlmCallData(sdkMsg))
        return;
    chatState.pendingChatMsg = sdkMsg;
    chatState.pendingChatMsgId = sdkMsg.message?.id;
    chatState.pendingStartMs = chatState.lastBoundaryMs;
    chatState.pendingEndMs = Date.now();
}
function flushPendingChat(tracer, parentSpan, chatState, captureContent, subagentTracker) {
    const sdkMsg = chatState.pendingChatMsg;
    if (!sdkMsg)
        return;
    delete chatState.pendingChatMsg;
    delete chatState.pendingChatMsgId;
    const endMs = chatState.pendingEndMs ?? Date.now();
    const savedStartMs = chatState.pendingStartMs;
    delete chatState.pendingStartMs;
    delete chatState.pendingEndMs;
    const betaMessage = sdkMsg.message;
    const model = String(betaMessage?.model || 'unknown');
    const spanName = generateSpanName('chat', model);
    let effectiveParent = parentSpan;
    const parentToolUseId = sdkMsg.parent_tool_use_id;
    if (parentToolUseId) {
        const subagentSpan = subagentTracker.getSpanForToolUseId(parentToolUseId);
        if (subagentSpan)
            effectiveParent = subagentSpan;
    }
    const parentCtx = api_1.trace.setSpan(api_1.context.active(), effectiveParent);
    const startMs = savedStartMs ?? chatState.lastBoundaryMs ?? endMs;
    const chatSpan = tracer.startSpan(spanName, {
        kind: api_1.SpanKind.CLIENT,
        attributes: {
            [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
            [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_ANTHROPIC,
        },
        startTime: new Date(startMs),
    }, parentCtx);
    const inputMessages = chatState.pendingInput;
    delete chatState.pendingInput;
    setChatSpanAttributes(chatSpan, sdkMsg, captureContent, inputMessages, chatState.systemInstructionsJson, chatState.toolDefinitionsJson);
    chatSpan.end(new Date(endMs));
    chatState.lastBoundaryMs = endMs;
}
// ---------------------------------------------------------------------------
// Chat span attributes
// ---------------------------------------------------------------------------
function setChatSpanAttributes(span, sdkMsg, captureContent, inputMessages, systemInstructionsJson, toolDefinitionsJson) {
    try {
        const betaMessage = sdkMsg.message;
        const model = betaMessage?.model ? String(betaMessage.model) : null;
        span.setAttribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE);
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, SERVER_ADDRESS);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, SERVER_PORT);
        span.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, constant_1.SDK_NAME);
        span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment ?? 'default');
        span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName ?? 'default');
        span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, constant_1.SDK_VERSION);
        if (model) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, model);
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, model);
        }
        const usage = betaMessage?.usage;
        const usageAttrs = usage ? extractUsage(usage) : {};
        for (const [key, value] of Object.entries(usageAttrs)) {
            span.setAttribute(key, value);
        }
        let stopReason = betaMessage?.stop_reason;
        if (!stopReason) {
            const content = betaMessage?.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'tool_use') {
                        stopReason = 'tool_use';
                        break;
                    }
                }
            }
        }
        const mappedReason = mapFinishReason(stopReason);
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [mappedReason]);
        const messageId = betaMessage?.id;
        if (messageId) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, String(messageId));
        }
        const sessionId = sdkMsg.session_id;
        if (sessionId) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, String(sessionId));
        }
        const inputTokens = usageAttrs[semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS] ?? 0;
        const outputTokens = usageAttrs[semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS] ?? 0;
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = model ? helpers_1.default.getChatModelCost(model, pricingInfo, inputTokens, outputTokens) : 0;
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_COST, cost);
        let outputMessages = null;
        if (captureContent) {
            if (inputMessages) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, JSON.stringify(inputMessages));
            }
            outputMessages = buildOutputMessages(betaMessage, mappedReason);
            if (outputMessages) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(outputMessages));
            }
        }
        const versionExtras = stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: model ?? undefined,
            temperature: null,
            top_p: null,
            max_tokens: null,
        });
        (0, helpers_1.applyCustomSpanAttributes)(span);
        span.setStatus({ code: api_1.SpanStatusCode.OK });
        if (captureContent) {
            emitChatInferenceEvent(span, model, messageId, sessionId, mappedReason, usageAttrs, inputMessages, outputMessages, versionExtras);
        }
        if (!config_1.default.disableMetrics) {
            recordChatMetrics(model, inputTokens, outputTokens, cost);
        }
    }
    catch { /* swallow */ }
}
// ---------------------------------------------------------------------------
// Build OTel-compliant output messages from BetaMessage content blocks
// ---------------------------------------------------------------------------
function buildOutputMessages(betaMessage, mappedFinishReason) {
    try {
        const content = betaMessage?.content;
        if (!content || !Array.isArray(content))
            return null;
        const parts = [];
        for (const block of content) {
            if (block.type === 'text') {
                if (block.text) {
                    parts.push({ type: 'text', content: truncateContent(String(block.text)) });
                }
            }
            else if (block.type === 'thinking') {
                if (block.thinking) {
                    parts.push({ type: 'reasoning', content: truncateContent(String(block.thinking)) });
                }
            }
            else if (block.type === 'tool_use') {
                let toolInput = block.input || {};
                if (typeof toolInput !== 'object') {
                    try {
                        toolInput = JSON.parse(String(toolInput));
                    }
                    catch {
                        toolInput = {};
                    }
                }
                parts.push({
                    type: 'tool_call',
                    id: String(block.id || ''),
                    name: String(block.name || 'unknown'),
                    arguments: toolInput,
                });
            }
        }
        if (parts.length === 0)
            return null;
        return [{ role: 'assistant', parts, finish_reason: mappedFinishReason }];
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// Build OTel input from UserMessage tool results
// ---------------------------------------------------------------------------
function buildInputFromToolResults(sdkMsg) {
    try {
        const messageParam = sdkMsg.message;
        const content = messageParam?.content;
        if (!content || !Array.isArray(content))
            return null;
        const parts = [];
        for (const block of content) {
            if (block.type === 'tool_result') {
                const toolUseId = block.tool_use_id;
                let resultContent = block.content;
                if (Array.isArray(resultContent)) {
                    resultContent = resultContent.map((c) => c.text || JSON.stringify(c)).join('');
                }
                parts.push({
                    type: 'tool_call_response',
                    id: toolUseId ? String(toolUseId) : '',
                    response: resultContent ? truncateContent(String(resultContent)) : '',
                });
            }
        }
        if (parts.length === 0)
            return null;
        return [{ role: 'user', parts }];
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// Emit gen_ai.client.inference.operation.details event for chat spans
// ---------------------------------------------------------------------------
function emitChatInferenceEvent(span, model, messageId, sessionId, mappedReason, usageAttrs, inputMessages, outputMessages, versionExtras) {
    if (config_1.default.disableEvents)
        return;
    try {
        const attributes = {
            [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
            [semantic_convention_1.default.SERVER_ADDRESS]: SERVER_ADDRESS,
            [semantic_convention_1.default.SERVER_PORT]: SERVER_PORT,
        };
        if (model) {
            attributes[semantic_convention_1.default.GEN_AI_REQUEST_MODEL] = model;
            attributes[semantic_convention_1.default.GEN_AI_RESPONSE_MODEL] = model;
        }
        if (messageId) {
            attributes[semantic_convention_1.default.GEN_AI_RESPONSE_ID] = String(messageId);
        }
        if (sessionId) {
            attributes[semantic_convention_1.default.GEN_AI_CONVERSATION_ID] = String(sessionId);
        }
        if (mappedReason) {
            attributes[semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON] = [mappedReason];
        }
        for (const [key, value] of Object.entries(usageAttrs)) {
            attributes[key] = value;
        }
        if (inputMessages != null) {
            attributes[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = inputMessages;
        }
        if (outputMessages != null) {
            attributes[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessages;
        }
        if (versionExtras) {
            Object.assign(attributes, versionExtras);
        }
        helpers_1.default.emitInferenceEvent(span, attributes);
    }
    catch { /* swallow */ }
}
// ---------------------------------------------------------------------------
// Chat metrics
// ---------------------------------------------------------------------------
function recordChatMetrics(model, inputTokens, outputTokens, cost) {
    try {
        const attributes = {
            [semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME]: constant_1.SDK_NAME,
            [semantic_conventions_1.ATTR_SERVICE_NAME]: config_1.default.applicationName ?? 'default',
            [semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT]: config_1.default.environment ?? 'default',
            [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_ANTHROPIC,
            [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
            [semantic_convention_1.default.SERVER_ADDRESS]: SERVER_ADDRESS,
            [semantic_convention_1.default.SERVER_PORT]: SERVER_PORT,
        };
        if (model) {
            attributes[semantic_convention_1.default.GEN_AI_REQUEST_MODEL] = model;
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
// Process result message — finalize root span with usage/cost data
// ---------------------------------------------------------------------------
function processResultMessage(span, sdkMsg, captureContent) {
    const resultUsage = { inputTokens: 0, outputTokens: 0 };
    try {
        const sessionId = sdkMsg.session_id;
        if (sessionId) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, String(sessionId));
        }
        const usage = sdkMsg.usage;
        if (usage) {
            const usageAttrs = extractUsage(usage);
            for (const [key, value] of Object.entries(usageAttrs)) {
                span.setAttribute(key, value);
            }
            resultUsage.inputTokens = usageAttrs[semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS] ?? 0;
            resultUsage.outputTokens = usageAttrs[semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS] ?? 0;
        }
        const totalCost = sdkMsg.total_cost_usd;
        if (totalCost != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_COST, Number(totalCost) || 0);
        }
        const modelUsage = sdkMsg.modelUsage;
        if (modelUsage && typeof modelUsage === 'object') {
            const modelNames = Object.keys(modelUsage);
            if (modelNames.length > 0) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, String(modelNames[0]));
            }
        }
        if (sdkMsg.num_turns != null) {
            span.setAttribute('gen_ai.agent.num_turns', Number(sdkMsg.num_turns) || 0);
        }
        if (sdkMsg.duration_ms != null) {
            span.setAttribute('gen_ai.agent.duration_ms', Number(sdkMsg.duration_ms) || 0);
        }
        if (sdkMsg.duration_api_ms != null) {
            span.setAttribute('gen_ai.agent.duration_api_ms', Number(sdkMsg.duration_api_ms) || 0);
        }
        if (sdkMsg.is_error) {
            const errResult = sdkMsg.errors?.join('; ') || sdkMsg.result || 'unknown error';
            span.setAttribute(semantic_convention_1.default.ERROR_TYPE, 'AgentError');
            span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: String(errResult) });
        }
        else {
            span.setStatus({ code: api_1.SpanStatusCode.OK });
        }
        if (captureContent) {
            const result = sdkMsg.result;
            if (result) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, JSON.stringify([{
                        role: 'assistant',
                        parts: [{ type: 'text', content: truncateContent(String(result)) }],
                    }]));
            }
        }
    }
    catch { /* swallow */ }
    return resultUsage;
}
// ---------------------------------------------------------------------------
// Message stream processor
// ---------------------------------------------------------------------------
function processMessage(sdkMsg, span, toolTracker, subagentTracker, captureContent, tracer, chatState) {
    const msgType = sdkMsg.type;
    let resultUsage = null;
    if (msgType === 'assistant') {
        updateRootFromAssistant(span, sdkMsg);
        if (hasLlmCallData(sdkMsg)) {
            const newMsgId = sdkMsg.message?.id;
            const pendingMsgId = chatState.pendingChatMsgId;
            if (pendingMsgId != null && newMsgId !== pendingMsgId) {
                flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
            }
            bufferChatMessage(sdkMsg, chatState);
        }
    }
    else if (msgType === 'user') {
        flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
        if (captureContent) {
            const toolInput = buildInputFromToolResults(sdkMsg);
            if (toolInput) {
                chatState.pendingInput = toolInput;
            }
        }
    }
    else if (msgType === 'result') {
        flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
        resultUsage = processResultMessage(span, sdkMsg, captureContent);
    }
    else if (msgType === 'system' && sdkMsg.subtype === 'task_started') {
        flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
        try {
            const taskId = sdkMsg.task_id;
            const description = sdkMsg.description;
            const toolUseId = sdkMsg.tool_use_id;
            if (taskId) {
                subagentTracker.startSubagent(taskId, description, toolUseId);
            }
        }
        catch { /* swallow */ }
    }
    else if (msgType === 'system' && sdkMsg.subtype === 'task_notification') {
        flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
        try {
            const taskId = sdkMsg.task_id;
            const status = sdkMsg.status;
            const isError = status === 'failed' || status === 'stopped';
            const errorMsg = isError ? sdkMsg.summary : null;
            const taskUsage = sdkMsg.usage;
            if (taskId) {
                subagentTracker.endSubagent(taskId, isError, errorMsg, taskUsage);
            }
        }
        catch { /* swallow */ }
    }
    chatState.lastBoundaryMs = Date.now();
    return resultUsage;
}
function updateRootFromAssistant(span, sdkMsg) {
    try {
        const model = sdkMsg.message?.model;
        if (model) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, String(model));
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, String(model));
        }
        const sessionId = sdkMsg.session_id;
        if (sessionId) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, String(sessionId));
        }
    }
    catch { /* swallow */ }
}
// ---------------------------------------------------------------------------
// Message-based tool span fallback (when hooks don't fire)
// ---------------------------------------------------------------------------
function processToolBlocksFromMessages(sdkMsg, toolTracker, subagentTracker) {
    const msgType = sdkMsg.type;
    if (msgType === 'assistant') {
        const content = sdkMsg.message?.content;
        if (!content || !Array.isArray(content))
            return;
        const parentToolUseId = sdkMsg.parent_tool_use_id;
        let effectiveParent;
        if (parentToolUseId) {
            effectiveParent = subagentTracker.getSpanForToolUseId(parentToolUseId);
        }
        for (const block of content) {
            if (block.type === 'tool_use') {
                const toolName = block.name || 'unknown';
                const toolInput = block.input;
                const toolId = block.id;
                if (toolId && !toolTracker._inFlight.has(toolId) && !toolTracker._completed.has(toolId)) {
                    if (effectiveParent) {
                        const spanName = generateSpanName('execute_tool', toolName);
                        const parentCtx = api_1.trace.setSpan(api_1.context.active(), effectiveParent);
                        const span = toolTracker['_tracer'].startSpan(spanName, {
                            kind: api_1.SpanKind.INTERNAL,
                            attributes: {
                                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS,
                                [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
                            },
                        }, parentCtx);
                        setToolSpanAttributes(span, toolName, toolInput, toolId, config_1.default.captureMessageContent ?? true);
                        toolTracker._inFlight.set(toolId, span);
                    }
                    else {
                        toolTracker.startTool(toolName, toolInput, toolId);
                    }
                }
            }
        }
    }
    else if (msgType === 'user') {
        const content = sdkMsg.message?.content;
        if (!content || !Array.isArray(content))
            return;
        for (const block of content) {
            if (block.type === 'tool_result') {
                const toolUseId = block.tool_use_id;
                const isError = block.is_error;
                const resultContent = block.content;
                if (toolUseId && toolTracker._inFlight.has(toolUseId)) {
                    if (isError) {
                        toolTracker.endToolError(toolUseId, resultContent);
                    }
                    else {
                        toolTracker.endTool(toolUseId, resultContent);
                    }
                }
            }
        }
    }
}
// ---------------------------------------------------------------------------
// Set initial span attributes on the root invoke_agent span
// ---------------------------------------------------------------------------
function setInitialSpanAttributes(span, options, prompt, captureContent) {
    try {
        span.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT);
        span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, semantic_convention_1.default.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK);
        span.setAttribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE);
        span.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, constant_1.SDK_NAME);
        span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment ?? 'default');
        span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName ?? 'default');
        span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, constant_1.SDK_VERSION);
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, SERVER_ADDRESS);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, SERVER_PORT);
        const agentName = resolveAgentName(options);
        if (agentName) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, agentName);
        }
        const model = options?.model;
        if (model) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, String(model));
        }
        if (captureContent) {
            const systemPrompt = options?.systemPrompt;
            if (systemPrompt && typeof systemPrompt === 'string') {
                span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, JSON.stringify([{ type: 'text', content: truncateContent(systemPrompt) }]));
            }
            if (prompt && typeof prompt === 'string') {
                span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, JSON.stringify([{
                        role: 'user',
                        parts: [{ type: 'text', content: truncateContent(prompt) }],
                    }]));
            }
        }
        // gen_ai.tool.definitions — surface tool schemas declared on the agent's
        // `options.tools`. Supports both the OpenAI/Anthropic-style array shape
        // (handled directly by buildToolDefinitions) and the Claude Agent SDK's
        // MCP-style object map of `{ name: { description, input_schema } }`.
        const optionTools = options?.tools;
        let normalizedTools = optionTools;
        if (optionTools && !Array.isArray(optionTools) && typeof optionTools === 'object') {
            normalizedTools = Object.entries(optionTools).map(([name, def]) => ({
                name,
                description: def?.description ?? '',
                parameters: def?.parameters ?? def?.input_schema ?? def?.inputSchema ?? {},
            }));
        }
        const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(normalizedTools);
        if (toolDefinitionsJson) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
        }
        (0, helpers_1.applyCustomSpanAttributes)(span);
    }
    catch { /* swallow */ }
}
// ---------------------------------------------------------------------------
// Finalize root span — record duration and token usage metrics
// ---------------------------------------------------------------------------
function finalizeSpan(span, startTime, inputTokens, outputTokens) {
    try {
        const duration = (Date.now() / 1000) - startTime;
        span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
        if (!config_1.default.disableMetrics) {
            const attributes = {
                [semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME]: constant_1.SDK_NAME,
                [semantic_conventions_1.ATTR_SERVICE_NAME]: config_1.default.applicationName ?? 'default',
                [semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT]: config_1.default.environment ?? 'default',
                [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
                [GEN_AI_SYSTEM_ATTR]: GEN_AI_SYSTEM_VALUE,
                [semantic_convention_1.default.SERVER_ADDRESS]: SERVER_ADDRESS,
                [semantic_convention_1.default.SERVER_PORT]: SERVER_PORT,
            };
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
        }
    }
    catch { /* swallow */ }
}
// ---------------------------------------------------------------------------
// patchQuery — wraps the `query()` export from @anthropic-ai/claude-agent-sdk
// ---------------------------------------------------------------------------
function patchQuery(tracer) {
    return (originalQuery) => {
        return function wrappedQuery(params) {
            const captureContent = config_1.default.captureMessageContent ?? true;
            const prompt = params.prompt;
            const userOptions = params.options;
            const options = userOptions ? { ...userOptions } : {};
            const agentName = resolveAgentName(options);
            const spanName = generateSpanName('query', agentName);
            const span = tracer.startSpan(spanName, {
                kind: api_1.SpanKind.INTERNAL,
                attributes: {
                    [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
                    [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
                },
            });
            const spanContext = api_1.trace.setSpan(api_1.context.active(), span);
            const startTime = Date.now() / 1000;
            const chatState = { lastBoundaryMs: Date.now() };
            const toolTracker = new ToolSpanTracker(tracer, span, captureContent);
            const subagentTracker = new SubagentSpanTracker(tracer, toolTracker);
            const aggregateUsage = { inputTokens: 0, outputTokens: 0 };
            if (prompt && typeof prompt === 'string' && captureContent) {
                chatState.pendingInput = [{
                        role: 'user',
                        parts: [{ type: 'text', content: truncateContent(prompt) }],
                    }];
            }
            // Capture system instructions and tool definitions once per query so
            // each chat span can stamp the same `openlit.agent.version_hash`.
            try {
                const systemPrompt = options?.systemPrompt;
                if (systemPrompt && typeof systemPrompt === 'string') {
                    chatState.systemInstructionsJson = JSON.stringify([
                        { type: 'text', content: systemPrompt },
                    ]);
                }
                const optionTools = options?.tools;
                let normalizedTools = optionTools;
                if (optionTools && !Array.isArray(optionTools) && typeof optionTools === 'object') {
                    normalizedTools = Object.entries(optionTools).map(([name, def]) => ({
                        name,
                        description: def?.description ?? '',
                        parameters: def?.parameters ?? def?.input_schema ?? def?.inputSchema ?? {},
                    }));
                }
                const toolDefs = helpers_1.default.buildToolDefinitions(normalizedTools);
                if (toolDefs)
                    chatState.toolDefinitionsJson = toolDefs;
            }
            catch { /* swallow */ }
            injectHooks(options, toolTracker, subagentTracker);
            setInitialSpanAttributes(span, options, prompt, captureContent);
            (0, helpers_1.setFrameworkLlmActive)();
            let query;
            try {
                query = api_1.context.with(spanContext, () => {
                    return originalQuery.call(this, { prompt, options });
                });
            }
            catch (e) {
                (0, helpers_1.resetFrameworkLlmActive)();
                helpers_1.default.handleException(span, e);
                span.end();
                throw e;
            }
            let done = false;
            const cleanup = () => {
                if (done)
                    return;
                done = true;
                (0, helpers_1.resetFrameworkLlmActive)();
                subagentTracker.endAll();
                toolTracker.endAll();
                finalizeSpan(span, startTime, aggregateUsage.inputTokens, aggregateUsage.outputTokens);
                span.end();
            };
            const originalNext = query.next.bind(query);
            const originalReturn = query.return?.bind(query);
            const originalThrow = query.throw?.bind(query);
            return new Proxy(query, {
                get(target, prop, receiver) {
                    if (prop === 'next') {
                        return async function (...args) {
                            try {
                                const result = await originalNext(...args);
                                if (result.done) {
                                    if (!done) {
                                        flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
                                        if (aggregateUsage.inputTokens === 0 && aggregateUsage.outputTokens === 0) {
                                            span.setStatus({ code: api_1.SpanStatusCode.OK });
                                        }
                                    }
                                    cleanup();
                                    return result;
                                }
                                const sdkMsg = result.value;
                                try {
                                    const msgUsage = processMessage(sdkMsg, span, toolTracker, subagentTracker, captureContent, tracer, chatState);
                                    if (msgUsage) {
                                        aggregateUsage.inputTokens = msgUsage.inputTokens;
                                        aggregateUsage.outputTokens = msgUsage.outputTokens;
                                    }
                                    processToolBlocksFromMessages(sdkMsg, toolTracker, subagentTracker);
                                }
                                catch { /* swallow processing errors */ }
                                return result;
                            }
                            catch (e) {
                                if (!done) {
                                    helpers_1.default.handleException(span, e);
                                }
                                cleanup();
                                throw e;
                            }
                        };
                    }
                    if (prop === 'return') {
                        return async function (value) {
                            cleanup();
                            return originalReturn ? originalReturn(value) : { done: true, value };
                        };
                    }
                    if (prop === 'throw') {
                        return async function (e) {
                            if (!done) {
                                helpers_1.default.handleException(span, e instanceof Error ? e : new Error(String(e)));
                            }
                            cleanup();
                            return originalThrow ? originalThrow(e) : { done: true, value: undefined };
                        };
                    }
                    if (prop === Symbol.asyncIterator) {
                        return function () { return receiver; };
                    }
                    return Reflect.get(target, prop, receiver);
                },
            });
        };
    };
}
//# sourceMappingURL=wrapper.js.map