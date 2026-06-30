"use strict";
/**
 * Strands Agents instrumentation utilities.
 *
 * Provides model-to-provider mapping, server address inference, content
 * extraction from Strands native span events, inference event emission,
 * and metrics recording.
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/strands/utils.py
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
exports.inferServerAddress = inferServerAddress;
exports.inferProviderName = inferProviderName;
exports.extractContentFromEvents = extractContentFromEvents;
exports.truncateContent = truncateContent;
exports.truncateMessageContent = truncateMessageContent;
exports.recordStrandsMetrics = recordStrandsMetrics;
exports.emitStrandsInferenceEvent = emitStrandsInferenceEvent;
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importStar(require("../../helpers"));
const metrics_1 = __importDefault(require("../../otel/metrics"));
// -------------------------------------------------------------------------
// Model prefix → provider mapping (mirrors Python _MODEL_PREFIX_TO_PROVIDER)
// -------------------------------------------------------------------------
const MODEL_PREFIX_TO_PROVIDER = [
    ['anthropic.', 'aws.bedrock'],
    ['amazon.', 'aws.bedrock'],
    ['meta.', 'aws.bedrock'],
    ['us.anthropic.', 'aws.bedrock'],
    ['us.amazon.', 'aws.bedrock'],
    ['us.meta.', 'aws.bedrock'],
    ['eu.anthropic.', 'aws.bedrock'],
    ['eu.amazon.', 'aws.bedrock'],
    ['eu.meta.', 'aws.bedrock'],
    ['gpt-', 'openai'],
    ['o1', 'openai'],
    ['o3', 'openai'],
    ['o4', 'openai'],
    ['claude', 'anthropic'],
    ['gemini', 'google'],
    ['mistral', 'mistral_ai'],
    ['command', 'cohere'],
    ['deepseek', 'deepseek'],
];
function inferServerAddress(modelName) {
    if (!modelName)
        return ['', 0];
    const lower = modelName.toLowerCase();
    for (const [prefix, provider] of MODEL_PREFIX_TO_PROVIDER) {
        if (lower.startsWith(prefix)) {
            return (0, helpers_1.getServerAddressForProvider)(provider);
        }
    }
    return ['', 0];
}
function inferProviderName(modelName) {
    if (!modelName)
        return '';
    const lower = modelName.toLowerCase();
    for (const [prefix, provider] of MODEL_PREFIX_TO_PROVIDER) {
        if (lower.startsWith(prefix)) {
            return provider;
        }
    }
    return '';
}
// -------------------------------------------------------------------------
// Content extraction from Strands span events
// -------------------------------------------------------------------------
function safeJsonParse(value) {
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch {
            return value;
        }
    }
    return value;
}
/**
 * Convert Strands Bedrock-style content blocks to OTel message parts.
 */
function convertStrandsContentToParts(content) {
    let blocks = safeJsonParse(content);
    if (!Array.isArray(blocks)) {
        blocks = blocks ? [blocks] : [];
    }
    const parts = [];
    for (const block of blocks) {
        if (typeof block === 'object' && block !== null) {
            if ('text' in block) {
                parts.push({ type: 'text', content: block.text });
            }
            else if ('toolUse' in block) {
                const tu = block.toolUse;
                parts.push({
                    type: 'tool_call',
                    id: tu.toolUseId || '',
                    name: tu.name || '',
                    arguments: tu.input || {},
                });
            }
            else if ('toolResult' in block) {
                const tr = block.toolResult;
                parts.push({
                    type: 'tool_call_response',
                    id: tr.toolUseId || '',
                    response: tr.content || '',
                });
            }
            else {
                for (const [key, value] of Object.entries(block)) {
                    parts.push({ type: key, content: value });
                }
            }
        }
        else if (typeof block === 'string') {
            parts.push({ type: 'text', content: block });
        }
    }
    return parts.length > 0 ? parts : [{ type: 'text', content: String(content) }];
}
/**
 * Extract message content from Strands span events.
 *
 * Handles both legacy named events (gen_ai.user.message, gen_ai.choice, etc.)
 * and the gen_ai.client.inference.operation.details event convention.
 *
 * Returns [inputMessages, outputMessages, systemInstructions, toolDefinitions].
 */
function extractContentFromEvents(span, operation) {
    const inputMsgs = [];
    const outputMsgs = [];
    let systemInstructions = null;
    let toolDefinitions = null;
    for (const event of span.events || []) {
        const ea = event.attributes || {};
        if (event.name === semantic_convention_1.default.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS) {
            if (ea[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES]) {
                const raw = safeJsonParse(ea[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES]);
                if (Array.isArray(raw))
                    inputMsgs.push(...raw);
                else if (raw)
                    inputMsgs.push(raw);
            }
            if (ea[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES]) {
                const raw = safeJsonParse(ea[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES]);
                if (Array.isArray(raw))
                    outputMsgs.push(...raw);
                else if (raw)
                    outputMsgs.push(raw);
            }
            if (ea[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS]) {
                systemInstructions = String(ea[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS]);
            }
            if (ea[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS]) {
                toolDefinitions = String(ea[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS]);
            }
            continue;
        }
        if (event.name === 'gen_ai.system.message') {
            systemInstructions = String(ea.content || '');
        }
        else if (event.name === 'gen_ai.user.message') {
            const content = ea.content || '';
            const parts = convertStrandsContentToParts(content);
            inputMsgs.push({ role: 'user', parts });
        }
        else if (event.name === 'gen_ai.assistant.message') {
            const content = ea.content || '';
            const parts = convertStrandsContentToParts(content);
            inputMsgs.push({ role: 'assistant', parts });
        }
        else if (event.name === 'gen_ai.tool.message') {
            const content = ea.content || '';
            const toolId = ea.id || '';
            if (operation === 'execute_tool') {
                inputMsgs.push({
                    role: 'tool',
                    parts: [{
                            type: 'tool_call',
                            id: toolId,
                            name: '',
                            arguments: safeJsonParse(content),
                        }],
                });
            }
            else {
                inputMsgs.push({
                    role: 'tool',
                    parts: [{
                            type: 'tool_call_response',
                            id: toolId,
                            response: safeJsonParse(content),
                        }],
                });
            }
        }
        else if (event.name === 'gen_ai.choice') {
            const message = ea.message || '';
            const finishReason = ea.finish_reason || '';
            if (operation === 'execute_tool') {
                outputMsgs.push({
                    role: 'tool',
                    parts: convertStrandsContentToParts(message),
                });
            }
            else {
                const parts = convertStrandsContentToParts(message);
                const entry = { role: 'assistant', parts };
                if (finishReason)
                    entry.finish_reason = String(finishReason);
                outputMsgs.push(entry);
            }
        }
    }
    return [inputMsgs, outputMsgs, systemInstructions, toolDefinitions];
}
// -------------------------------------------------------------------------
// Content truncation
// -------------------------------------------------------------------------
function truncateContent(content) {
    const maxLen = config_1.default.maxContentLength;
    if (maxLen && content.length > maxLen) {
        return content.substring(0, maxLen) + '...';
    }
    return content;
}
function truncateMessageContent(messages) {
    for (const msg of messages) {
        if (msg.parts && Array.isArray(msg.parts)) {
            for (const part of msg.parts) {
                if (part.content && typeof part.content === 'string') {
                    part.content = truncateContent(part.content);
                }
                if (part.response && typeof part.response === 'string') {
                    part.response = truncateContent(part.response);
                }
                if (part.arguments && typeof part.arguments === 'string') {
                    part.arguments = truncateContent(part.arguments);
                }
            }
        }
    }
}
// -------------------------------------------------------------------------
// Metrics recording (mirrors Python record_strands_metrics)
// -------------------------------------------------------------------------
function recordStrandsMetrics(operation, duration, modelName, serverAddress, serverPort) {
    try {
        const attributes = {
            [semantic_convention_1.default.GEN_AI_OPERATION]: operation,
            [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_STRANDS,
            'service.name': config_1.default.applicationName || 'default',
            'deployment.environment': config_1.default.environment || 'default',
        };
        if (modelName && modelName !== 'unknown') {
            attributes[semantic_convention_1.default.GEN_AI_REQUEST_MODEL] = modelName;
        }
        if (serverAddress) {
            attributes[semantic_convention_1.default.SERVER_ADDRESS] = serverAddress;
        }
        if (serverPort) {
            attributes[semantic_convention_1.default.SERVER_PORT] = serverPort;
        }
        metrics_1.default.genaiClientOperationDuration?.record(duration, attributes);
    }
    catch {
        // ignore
    }
}
// -------------------------------------------------------------------------
// Inference event emission (mirrors Python emit_strands_inference_event)
// -------------------------------------------------------------------------
function emitStrandsInferenceEvent(span, requestModel, serverAddress, serverPort, extra = {}) {
    try {
        if (config_1.default.disableEvents)
            return;
        const eventAttrs = {
            [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
        };
        if (requestModel) {
            eventAttrs[semantic_convention_1.default.GEN_AI_REQUEST_MODEL] = requestModel;
        }
        if (serverAddress) {
            eventAttrs[semantic_convention_1.default.SERVER_ADDRESS] = serverAddress;
        }
        if (serverPort) {
            eventAttrs[semantic_convention_1.default.SERVER_PORT] = serverPort;
        }
        if (extra.inputTokens != null) {
            eventAttrs[semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS] = extra.inputTokens;
        }
        if (extra.outputTokens != null) {
            eventAttrs[semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS] = extra.outputTokens;
        }
        if (extra.cacheReadInputTokens != null) {
            eventAttrs[semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] = extra.cacheReadInputTokens;
        }
        if (extra.cacheCreationInputTokens != null) {
            eventAttrs[semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] = extra.cacheCreationInputTokens;
        }
        if (extra.responseId) {
            eventAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_ID] = extra.responseId;
        }
        if (extra.finishReasons) {
            eventAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON] = extra.finishReasons;
        }
        if (extra.systemInstructions) {
            eventAttrs[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS] = extra.systemInstructions;
        }
        if (extra.toolDefinitions) {
            eventAttrs[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS] = extra.toolDefinitions;
        }
        if (extra.versionExtras && typeof extra.versionExtras === 'object') {
            for (const [k, v] of Object.entries(extra.versionExtras)) {
                if (typeof v === 'string' && v)
                    eventAttrs[k] = v;
            }
        }
        if (config_1.default.captureMessageContent) {
            if (extra.inputMessages) {
                eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = JSON.stringify(extra.inputMessages);
            }
            if (extra.outputMessages) {
                eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = JSON.stringify(extra.outputMessages);
            }
        }
        helpers_1.default.emitInferenceEvent(span, eventAttrs);
    }
    catch {
        // ignore
    }
}
//# sourceMappingURL=utils.js.map