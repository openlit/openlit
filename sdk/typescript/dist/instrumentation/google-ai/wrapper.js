"use strict";
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
const api_1 = require("@opentelemetry/api");
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importStar(require("../../helpers"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
function spanCreationAttrs(operationName, requestModel) {
    return {
        [semantic_convention_1.default.GEN_AI_OPERATION]: operationName,
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: GoogleAIWrapper.aiSystem,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: GoogleAIWrapper.serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: GoogleAIWrapper.serverPort,
    };
}
class GoogleAIWrapper extends base_wrapper_1.default {
    /**
     * Stamp `openlit.agent.version_hash` (auto) and `gen_ai.agent.version`
     * (user override, if set) on the span and return the same attributes so
     * the caller can merge them into the inference event extras.
     */
    static _stampAgentVersion(span, args) {
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
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO],
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
    static _patchGenerateContent(tracer) {
        const genAIEndpoint = 'google.generativeai.models.generate_content';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const rawModel = this?.model || 'gemini-2.0-flash';
                const requestModel = rawModel.replace(/^models\//, '');
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT, requestModel),
                }, effectiveCtx);
                return api_1.context
                    .with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    return originalMethod.apply(this, args);
                })
                    .then((response) => {
                    if (response && response.stream && typeof response.stream[Symbol.asyncIterator] === 'function') {
                        const wrappedStream = GoogleAIWrapper._generateContentStreamGenerator({
                            args,
                            genAIEndpoint,
                            response: response.stream,
                            span,
                            requestModel,
                        });
                        return { ...response, stream: wrappedStream };
                    }
                    return GoogleAIWrapper._generateContent({ args, genAIEndpoint, response, span, requestModel });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: GoogleAIWrapper.aiSystem,
                        serverAddress: GoogleAIWrapper.serverAddress,
                        serverPort: GoogleAIWrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static async _generateContent({ args, genAIEndpoint, response, span, requestModel, }) {
        let metricParams;
        try {
            metricParams = await GoogleAIWrapper._generateContentCommonSetter({
                args,
                genAIEndpoint,
                result: response,
                span,
                requestModel,
            });
            return response;
        }
        catch (e) {
            helpers_1.default.handleException(span, e);
            throw e;
        }
        finally {
            span.end();
            if (metricParams) {
                base_wrapper_1.default.recordMetrics(span, metricParams);
            }
        }
    }
    static async *_generateContentStreamGenerator({ args, genAIEndpoint, response, span, requestModel, }) {
        let metricParams;
        const timestamps = [];
        const startTime = Date.now();
        try {
            const result = {
                model: '',
                text: '',
                responseId: '',
                candidates: [],
                usageMetadata: {
                    promptTokenCount: 0,
                    candidatesTokenCount: 0,
                    totalTokenCount: 0,
                },
                functionCall: null,
            };
            for await (const chunk of response) {
                timestamps.push(Date.now());
                if (chunk.modelVersion || chunk.model) {
                    result.model = chunk.modelVersion || chunk.model;
                }
                if (chunk.responseId) {
                    result.responseId = chunk.responseId;
                }
                const chunkText = typeof chunk.text === 'function' ? chunk.text() : chunk.text;
                if (chunkText) {
                    result.text += chunkText;
                }
                if (chunk.candidates && chunk.candidates.length > 0) {
                    if (result.candidates.length === 0) {
                        result.candidates = chunk.candidates.map((c) => ({
                            content: { parts: [{ text: '' }], role: 'model' },
                            finishReason: c.finishReason || '',
                            safetyRatings: c.safetyRatings || [],
                        }));
                    }
                    chunk.candidates.forEach((c, idx) => {
                        if (c.content?.parts) {
                            c.content.parts.forEach((part) => {
                                if (part.text) {
                                    result.candidates[idx].content.parts[0].text += part.text;
                                }
                                if (part.functionCall) {
                                    result.functionCall = part.functionCall;
                                }
                            });
                        }
                        if (c.finishReason) {
                            result.candidates[idx].finishReason = c.finishReason;
                        }
                    });
                }
                if (chunk.usageMetadata) {
                    result.usageMetadata = {
                        promptTokenCount: chunk.usageMetadata.promptTokenCount || result.usageMetadata.promptTokenCount,
                        candidatesTokenCount: chunk.usageMetadata.candidatesTokenCount || result.usageMetadata.candidatesTokenCount,
                        totalTokenCount: chunk.usageMetadata.totalTokenCount || result.usageMetadata.totalTokenCount,
                    };
                }
                yield chunk;
            }
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
            }
            metricParams = await GoogleAIWrapper._generateContentCommonSetter({
                args,
                genAIEndpoint,
                result,
                span,
                requestModel,
                ttft,
                tbt,
                isStream: true,
            });
            return result;
        }
        catch (e) {
            helpers_1.default.handleException(span, e);
            throw e;
        }
        finally {
            span.end();
            if (metricParams) {
                base_wrapper_1.default.recordMetrics(span, metricParams);
            }
        }
    }
    static async _generateContentCommonSetter({ args, genAIEndpoint, result, span, requestModel, ttft = 0, tbt = 0, isStream = false, }) {
        const captureContent = config_1.default.captureMessageContent;
        // Non-streaming: result = { response: GenerateContentResponse }
        // Streaming: result = our accumulated plain object
        const responseData = result.response || result;
        const config = args[0]?.config || args[1] || {};
        const { temperature, maxOutputTokens, topP, topK, stopSequences, frequencyPenalty, presencePenalty, systemInstruction, tools: _tools, } = config;
        // Request param attributes — only set when explicitly provided (matches Python)
        if (temperature != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, temperature);
        }
        if (maxOutputTokens != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, maxOutputTokens);
        }
        if (topP != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, topP);
        }
        if (topK != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_K, topK);
        }
        if (stopSequences) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, stopSequences);
        }
        if (frequencyPenalty) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, frequencyPenalty);
        }
        if (presencePenalty) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, presencePenalty);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, isStream);
        const responseModel = responseData.modelVersion || responseData.model || requestModel;
        const pricingInfo = config_1.default.pricingInfo || {};
        const usageMetadata = responseData.usageMetadata;
        const inputTokens = usageMetadata?.promptTokenCount || 0;
        const outputTokens = usageMetadata?.candidatesTokenCount || 0;
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);
        GoogleAIWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user: undefined,
            cost,
            aiSystem: GoogleAIWrapper.aiSystem,
            serverAddress: GoogleAIWrapper.serverAddress,
            serverPort: GoogleAIWrapper.serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        if (ttft > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        }
        if (tbt > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        }
        // Response ID
        const responseId = responseData.responseId || '';
        if (responseId) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, responseId);
        }
        // Finish reason
        const finishReason = responseData.candidates?.[0]?.finishReason || '';
        if (finishReason) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
        }
        // Output type
        const completionText = isStream
            ? responseData.text
            : (typeof responseData.text === 'function' ? responseData.text() : responseData.text);
        const outputType = typeof completionText === 'string'
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON;
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
        // Function calls / tool calls (matches Python: tool name, call id, args)
        const functionCall = isStream
            ? responseData.functionCall
            : responseData.candidates?.[0]?.content?.parts?.find((p) => p.functionCall)?.functionCall;
        if (functionCall) {
            if (functionCall.name) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, functionCall.name);
            }
            if (functionCall.args) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_ARGS, JSON.stringify(functionCall.args));
            }
        }
        // Reasoning tokens (Google: thoughts_token_count)
        const reasoningTokens = usageMetadata?.thoughtsTokenCount || 0;
        if (reasoningTokens > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_REASONING_TOKENS, reasoningTokens);
        }
        // Cache tokens (matches Python: cached_content_token_count, cache_creation_input_tokens)
        const cacheReadTokens = usageMetadata?.cachedContentTokenCount || 0;
        if (cacheReadTokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheReadTokens);
        }
        const cacheCreationTokens = usageMetadata?.cacheCreationInputTokens || 0;
        if (cacheCreationTokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheCreationTokens);
        }
        // Content attributes (gated by captureMessageContent)
        let inputMessagesJson;
        let outputMessagesJson;
        const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(Array.isArray(_tools)
            ? _tools.flatMap((tool) => Array.isArray(tool?.functionDeclarations) ? tool.functionDeclarations : tool)
            : _tools);
        // Compute system_instructions JSON regardless of captureContent so the
        // version hash still groups correctly when content capture is disabled.
        let systemInstructionsJson;
        if (systemInstruction) {
            let systemText = '';
            if (typeof systemInstruction === 'string') {
                systemText = systemInstruction;
            }
            else if (Array.isArray(systemInstruction)) {
                systemText = systemInstruction
                    .map((part) => (typeof part === 'string' ? part : (part?.text || '')))
                    .filter(Boolean)
                    .join('\n');
            }
            else if (Array.isArray(systemInstruction.parts)) {
                systemText = systemInstruction.parts
                    .map((part) => part?.text || '')
                    .filter(Boolean)
                    .join('\n');
            }
            else if (typeof systemInstruction.text === 'string') {
                systemText = systemInstruction.text;
            }
            if (systemText) {
                systemInstructionsJson = JSON.stringify([{ type: 'text', content: systemText }]);
            }
        }
        const versionExtras = GoogleAIWrapper._stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: responseModel || requestModel,
            temperature: temperature ?? null,
            top_p: topP ?? null,
            max_tokens: maxOutputTokens ?? null,
        });
        if (captureContent) {
            const contents = args[0]?.contents || args[0];
            let messages = [];
            if (typeof contents === 'string') {
                messages = [{ role: 'user', content: contents }];
            }
            else if (Array.isArray(contents)) {
                messages = contents.map((item) => ({
                    role: item.role === 'model' ? 'assistant' : (item.role || 'user'),
                    content: Array.isArray(item.parts)
                        ? item.parts.map((p) => p.text || '').join(' ')
                        : (item.parts || ''),
                }));
            }
            inputMessagesJson = helpers_1.default.buildInputMessages(messages);
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
            const outputContent = completionText
                || (responseData.candidates?.[0]?.content?.parts?.[0]?.text)
                || '';
            const toolCallsForOutput = functionCall ? [{
                    name: functionCall.name || '',
                    arguments: functionCall.args || {},
                }] : undefined;
            outputMessagesJson = helpers_1.default.buildOutputMessages(outputContent, finishReason || 'stop', toolCallsForOutput);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
            if (systemInstructionsJson) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstructionsJson);
            }
        }
        if (toolDefinitionsJson) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
        }
        // Emit inference event (independent of captureMessageContent, per rule)
        if (!config_1.default.disableEvents) {
            const eventAttrs = {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: responseModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: GoogleAIWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: GoogleAIWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: outputType,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
                ...versionExtras,
            };
            if (responseId) {
                eventAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_ID] = responseId;
            }
            if (finishReason) {
                eventAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON] = [finishReason];
            }
            if (captureContent) {
                if (inputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
                if (outputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
                if (systemInstructionsJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS] = systemInstructionsJson;
            }
            if (toolDefinitionsJson)
                eventAttrs[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS] = toolDefinitionsJson;
            helpers_1.default.emitInferenceEvent(span, eventAttrs);
        }
        return {
            genAIEndpoint,
            model: requestModel,
            user: undefined,
            cost,
            aiSystem: GoogleAIWrapper.aiSystem,
        };
    }
}
GoogleAIWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO;
GoogleAIWrapper.serverAddress = 'generativelanguage.googleapis.com';
GoogleAIWrapper.serverPort = 443;
exports.default = GoogleAIWrapper;
//# sourceMappingURL=wrapper.js.map