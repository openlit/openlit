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
// Derive the regional API endpoint from the model/session instance.
// @google-cloud/vertexai exposes `location` on GenerativeModel and ChatSession.
function extractServerAddress(instance) {
    const location = instance?.location ||
        instance?._location ||
        instance?.generativeModel?.location ||
        instance?.generativeModel?._location ||
        'us-central1';
    return `${location}-aiplatform.googleapis.com`;
}
// Non-chat: args[0] is the GenerateContentRequest.
// ChatSession: args[0] is the turn message; generationConfig/systemInstruction/tools
// are stored on the session instance from startChat().
function resolveRequestContext(instance, args, isChatSession) {
    if (!isChatSession) {
        return args[0] || {};
    }
    return {
        generationConfig: instance?.generationConfig,
        systemInstruction: instance?.systemInstruction,
        tools: instance?.tools,
    };
}
function spanCreationAttrs(operationName, requestModel, serverAddress) {
    return {
        [semantic_convention_1.default.GEN_AI_OPERATION]: operationName,
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: VertexAIWrapper.aiSystem,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: VertexAIWrapper.serverPort,
    };
}
class VertexAIWrapper extends base_wrapper_1.default {
    // Exposed as a static method so it can be unit-tested directly.
    // Strips full Vertex AI resource paths to the short model name.
    // e.g. projects/p/locations/l/publishers/google/models/gemini-2.0-flash → gemini-2.0-flash
    static _extractModelName(instance) {
        const raw = instance?.model ||
            instance?._modelId ||
            instance?.resourcePath ||
            instance?.generativeModel?.model ||
            instance?.generativeModel?._modelId ||
            instance?.generativeModel?.resourcePath ||
            'gemini-2.0-flash';
        return String(raw)
            .replace(/^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\//, '')
            .replace(/^publishers\/[^/]+\/models\//, '');
    }
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
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_VERTEXAI,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_VERTEXAI],
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
    // Shared span/context/error boilerplate for all four patch methods.
    // Only genAIEndpoint, isStream, and isChatSession vary between them.
    static _buildPatcher({ genAIEndpoint, isStream, isChatSession, tracer, }) {
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = VertexAIWrapper._extractModelName(this);
                const serverAddress = extractServerAddress(this);
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT, requestModel, serverAddress),
                }, effectiveCtx);
                return api_1.context
                    .with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    return originalMethod.apply(this, args);
                })
                    .then((result) => {
                    if (isStream) {
                        const wrappedStream = VertexAIWrapper._streamGenerator({
                            args,
                            genAIEndpoint,
                            instance: this,
                            stream: result.stream,
                            span,
                            requestModel,
                            serverAddress,
                            isChatSession,
                        });
                        return { ...result, stream: wrappedStream };
                    }
                    return VertexAIWrapper._processResponse({
                        args,
                        genAIEndpoint,
                        instance: this,
                        response: result,
                        span,
                        requestModel,
                        serverAddress,
                        isChatSession,
                    });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    (0, helpers_1.applyCustomSpanAttributes)(span);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: VertexAIWrapper.aiSystem,
                        serverAddress,
                        serverPort: VertexAIWrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static _patchGenerateContent(tracer) {
        return VertexAIWrapper._buildPatcher({
            genAIEndpoint: 'vertexai.generative_models.generate_content',
            isStream: false,
            isChatSession: false,
            tracer,
        });
    }
    static _patchGenerateContentStream(tracer) {
        return VertexAIWrapper._buildPatcher({
            genAIEndpoint: 'vertexai.generative_models.generate_content_stream',
            isStream: true,
            isChatSession: false,
            tracer,
        });
    }
    static _patchSendMessage(tracer) {
        return VertexAIWrapper._buildPatcher({
            genAIEndpoint: 'vertexai.generative_models.chat_session.send_message',
            isStream: false,
            isChatSession: true,
            tracer,
        });
    }
    static _patchSendMessageStream(tracer) {
        return VertexAIWrapper._buildPatcher({
            genAIEndpoint: 'vertexai.generative_models.chat_session.send_message_stream',
            isStream: true,
            isChatSession: true,
            tracer,
        });
    }
    static async _processResponse({ args, genAIEndpoint, instance, response, span, requestModel, serverAddress, isChatSession = false, }) {
        let metricParams;
        try {
            metricParams = await VertexAIWrapper._commonSetter({
                args,
                genAIEndpoint,
                instance,
                result: response,
                span,
                requestModel,
                serverAddress,
                isChatSession,
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
    static async *_streamGenerator({ args, genAIEndpoint, instance, stream, span, requestModel, serverAddress, isChatSession = false, }) {
        let metricParams;
        const timestamps = [];
        const startTime = Date.now();
        try {
            const accumulated = {
                text: '',
                candidates: [],
                usageMetadata: {
                    promptTokenCount: 0,
                    candidatesTokenCount: 0,
                    totalTokenCount: 0,
                    cachedContentTokenCount: 0,
                    cacheCreationInputTokens: 0,
                },
                functionCall: null,
            };
            for await (const chunk of stream) {
                timestamps.push(Date.now());
                if (chunk.candidates && chunk.candidates.length > 0) {
                    if (accumulated.candidates.length === 0) {
                        accumulated.candidates = chunk.candidates.map((c) => ({
                            content: { parts: [{ text: '' }], role: 'model' },
                            finishReason: c.finishReason || '',
                        }));
                    }
                    chunk.candidates.forEach((c, idx) => {
                        if (c.content?.parts) {
                            c.content.parts.forEach((part) => {
                                if (part.text && accumulated.candidates[idx]) {
                                    accumulated.candidates[idx].content.parts[0].text += part.text;
                                    accumulated.text += part.text;
                                }
                                if (part.functionCall) {
                                    accumulated.functionCall = part.functionCall;
                                }
                            });
                        }
                        if (c.finishReason && accumulated.candidates[idx]) {
                            accumulated.candidates[idx].finishReason = c.finishReason;
                        }
                    });
                }
                if (chunk.usageMetadata) {
                    const u = chunk.usageMetadata;
                    accumulated.usageMetadata = {
                        promptTokenCount: u.promptTokenCount || accumulated.usageMetadata.promptTokenCount,
                        candidatesTokenCount: u.candidatesTokenCount || accumulated.usageMetadata.candidatesTokenCount,
                        totalTokenCount: u.totalTokenCount || accumulated.usageMetadata.totalTokenCount,
                        cachedContentTokenCount: u.cachedContentTokenCount || accumulated.usageMetadata.cachedContentTokenCount,
                        cacheCreationInputTokens: u.cacheCreationInputTokens || accumulated.usageMetadata.cacheCreationInputTokens,
                    };
                }
                yield chunk;
            }
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const diffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = diffs.reduce((a, b) => a + b, 0) / diffs.length / 1000;
            }
            metricParams = await VertexAIWrapper._commonSetter({
                args,
                genAIEndpoint,
                instance,
                result: accumulated,
                span,
                requestModel,
                serverAddress,
                ttft,
                tbt,
                isStream: true,
                isChatSession,
            });
            return accumulated;
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
    static async _commonSetter({ args, genAIEndpoint, instance, result, span, requestModel, serverAddress, ttft = 0, tbt = 0, isStream = false, isChatSession = false, }) {
        const captureContent = config_1.default.captureMessageContent;
        // Non-streaming: result = {response: GenerateContentResponse}
        // Streaming: result = accumulated plain object
        const responseData = result.response || result;
        // @google-cloud/vertexai uses `generationConfig` (camelCase).
        const requestArg = resolveRequestContext(instance, args, isChatSession);
        const generationConfig = requestArg.generationConfig || {};
        const { temperature, maxOutputTokens, topP, topK, stopSequences, frequencyPenalty, presencePenalty, candidateCount, } = generationConfig;
        const systemInstruction = requestArg.systemInstruction;
        const _tools = requestArg.tools;
        // Request param attributes — only set when explicitly provided
        if (temperature != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, temperature);
        if (maxOutputTokens != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, maxOutputTokens);
        if (topP != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, topP);
        if (topK != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_K, topK);
        if (stopSequences)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, stopSequences);
        if (frequencyPenalty)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, frequencyPenalty);
        if (presencePenalty)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, presencePenalty);
        if (candidateCount != null && candidateCount !== 1) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_CHOICE_COUNT, candidateCount);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, isStream);
        const usageMetadata = responseData.usageMetadata;
        const inputTokens = usageMetadata?.promptTokenCount || 0;
        const outputTokens = usageMetadata?.candidatesTokenCount || 0;
        const cacheReadTokens = usageMetadata?.cachedContentTokenCount || 0;
        const cacheCreationTokens = usageMetadata?.cacheCreationInputTokens || 0;
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);
        VertexAIWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user: undefined,
            cost,
            aiSystem: VertexAIWrapper.aiSystem,
            serverAddress,
            serverPort: VertexAIWrapper.serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, requestModel);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        if (cacheReadTokens)
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheReadTokens);
        if (cacheCreationTokens)
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheCreationTokens);
        if (ttft > 0)
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        if (tbt > 0)
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        const responseId = responseData.id || responseData.name || '';
        if (responseId) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, responseId);
        }
        const finishReason = responseData.candidates?.[0]?.finishReason || '';
        if (finishReason) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
        }
        // Resolve completion text
        const completionText = isStream
            ? (responseData.text || '')
            : (responseData.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text || '');
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, typeof completionText === 'string'
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON);
        const outputType = typeof completionText === 'string'
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON;
        const functionCall = isStream
            ? responseData.functionCall
            : responseData.candidates?.[0]?.content?.parts?.find((p) => p.functionCall)?.functionCall;
        if (functionCall) {
            if (functionCall.name)
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, functionCall.name);
            if (functionCall.args)
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_ARGS, JSON.stringify(functionCall.args));
        }
        const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(Array.isArray(_tools)
            ? _tools.flatMap((tool) => Array.isArray(tool?.functionDeclarations) ? tool.functionDeclarations : [tool])
            : _tools);
        // System instructions — computed regardless of captureContent for agent version hash
        let systemInstructionsJson;
        if (systemInstruction) {
            let systemText = '';
            if (typeof systemInstruction === 'string') {
                systemText = systemInstruction;
            }
            else if (Array.isArray(systemInstruction.parts)) {
                systemText = systemInstruction.parts
                    .map((p) => p?.text || '')
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
        const versionExtras = VertexAIWrapper._stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: requestModel,
            temperature: temperature ?? null,
            top_p: topP ?? null,
            max_tokens: maxOutputTokens ?? null,
        });
        let inputMessagesJson;
        let outputMessagesJson;
        if (captureContent) {
            if (!isChatSession) {
                const contents = requestArg.contents;
                let messages = [];
                if (typeof contents === 'string') {
                    messages = [{ role: 'user', content: contents }];
                }
                else if (Array.isArray(contents)) {
                    messages = contents.map((item) => ({
                        role: item.role === 'model' ? 'assistant' : (item.role || 'user'),
                        content: Array.isArray(item.parts)
                            ? item.parts.map((p) => p.text || '').join(' ')
                            : String(item.parts || ''),
                    }));
                }
                inputMessagesJson = helpers_1.default.buildInputMessages(messages);
                span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
            }
            else {
                // ChatSession: capture the current turn message (args[0] can be string or Part[])
                const turnMessage = args[0];
                const turnText = typeof turnMessage === 'string'
                    ? turnMessage
                    : Array.isArray(turnMessage)
                        ? turnMessage.map((p) => (typeof p === 'string' ? p : p?.text || '')).join(' ')
                        : '';
                inputMessagesJson = helpers_1.default.buildInputMessages([{ role: 'user', content: turnText }]);
                span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
            }
            const outputContent = completionText || responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const toolCallsForOutput = functionCall
                ? [{ name: functionCall.name || '', arguments: functionCall.args || {} }]
                : undefined;
            outputMessagesJson = helpers_1.default.buildOutputMessages(outputContent, finishReason || 'stop', toolCallsForOutput);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
            if (systemInstructionsJson) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstructionsJson);
            }
        }
        if (toolDefinitionsJson) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
        }
        if (!config_1.default.disableEvents) {
            const eventAttrs = {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: requestModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: VertexAIWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: outputType,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
                ...versionExtras,
            };
            if (responseId)
                eventAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_ID] = responseId;
            if (finishReason)
                eventAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON] = [finishReason];
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
            aiSystem: VertexAIWrapper.aiSystem,
            serverAddress,
            serverPort: VertexAIWrapper.serverPort,
        };
    }
}
VertexAIWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_VERTEXAI;
VertexAIWrapper.serverPort = 443;
exports.default = VertexAIWrapper;
//# sourceMappingURL=wrapper.js.map