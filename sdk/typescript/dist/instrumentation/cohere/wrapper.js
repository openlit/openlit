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
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_COHERE,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: CohereWrapper.serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: CohereWrapper.serverPort,
    };
}
class CohereWrapper extends base_wrapper_1.default {
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
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_COHERE,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_COHERE],
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
    static _patchEmbed(tracer) {
        const genAIEndpoint = 'cohere.embed';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'embed-english-v2.0';
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_EMBEDDING} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_EMBEDDING, requestModel),
                }, effectiveCtx);
                return api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    const captureContent = config_1.default.captureMessageContent;
                    let metricParams;
                    try {
                        const response = await originalMethod.apply(this, args);
                        const _responseModel = response.model || requestModel;
                        const pricingInfo = config_1.default.pricingInfo || {};
                        const inputTokens = response.meta?.billedUnits?.inputTokens || 0;
                        const cost = helpers_1.default.getEmbedModelCost(requestModel, pricingInfo, inputTokens);
                        const { dimensions, encoding_format = 'float', texts = [], user } = args[0];
                        CohereWrapper.setBaseSpanAttributes(span, {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: CohereWrapper.aiSystem,
                            serverAddress: CohereWrapper.serverAddress,
                            serverPort: CohereWrapper.serverPort,
                        });
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_ENCODING_FORMATS, [encoding_format]);
                        if (dimensions) {
                            span.setAttribute(semantic_convention_1.default.GEN_AI_EMBEDDINGS_DIMENSION_COUNT, dimensions);
                        }
                        if (captureContent) {
                            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, JSON.stringify(texts));
                        }
                        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, response.id);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
                        metricParams = {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: CohereWrapper.aiSystem,
                        };
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
                });
            };
        };
    }
    static _patchChat(tracer) {
        const genAIEndpoint = 'cohere.chat';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'command-r-plus-08-2024';
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
                    return CohereWrapper._chat({ args, genAIEndpoint, response, span });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: CohereWrapper.aiSystem,
                        serverAddress: CohereWrapper.serverAddress,
                        serverPort: CohereWrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static _patchChatStream(tracer) {
        const genAIEndpoint = 'cohere.chat';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'command-r-plus-08-2024';
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
                    return helpers_1.default.createStreamProxy(response, CohereWrapper._chatGenerator({
                        args,
                        genAIEndpoint,
                        response,
                        span,
                    }));
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: CohereWrapper.aiSystem,
                        serverAddress: CohereWrapper.serverAddress,
                        serverPort: CohereWrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static async _chat({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        try {
            metricParams = await CohereWrapper._chatCommonSetter({
                args,
                genAIEndpoint,
                result: response,
                span,
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
    static async *_chatGenerator({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        const timestamps = [];
        const startTime = Date.now();
        try {
            let result = {
                response_id: '',
                text: '',
                generationId: '',
                chatHistory: [],
                finishReason: '',
                meta: {
                    apiVersion: { version: '1' },
                    billedUnits: { inputTokens: 0, outputTokens: 0 },
                },
            };
            for await (const chunk of response) {
                timestamps.push(Date.now());
                if (chunk.eventType === 'stream-end') {
                    result = chunk.response;
                }
                yield chunk;
            }
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
            }
            metricParams = await CohereWrapper._chatCommonSetter({
                args,
                genAIEndpoint,
                result,
                span,
                stream: true,
                ttft,
                tbt,
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
    static async _chatCommonSetter({ args, genAIEndpoint, result, span, stream = false, ttft = 0, tbt = 0, }) {
        const captureContent = config_1.default.captureMessageContent;
        const requestModel = args[0]?.model || 'command-r-plus-08-2024';
        const { message, messages, frequency_penalty = 0, max_tokens = null, presence_penalty = 0, seed = null, stop_sequences = null, temperature = 1, p: topP, k: topK, user, tools: _tools, } = args[0];
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, topP ?? 1);
        if (topK != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_K, topK);
        }
        if (max_tokens != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, temperature);
        if (presence_penalty) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, presence_penalty);
        }
        if (frequency_penalty) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, frequency_penalty);
        }
        if (seed != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_SEED, Number(seed));
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, stream);
        if (stop_sequences) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, Array.isArray(stop_sequences) ? stop_sequences : [stop_sequences]);
        }
        const inputMessages = messages || (message ? [{ role: 'user', content: message }] : []);
        if (captureContent) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages(inputMessages));
        }
        const responseId = result.response_id || result.id || '';
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, responseId);
        const pricingInfo = config_1.default.pricingInfo || {};
        const inputTokens = result.meta?.billedUnits?.inputTokens
            ?? result.usage?.billed_units?.input_tokens ?? 0;
        const outputTokens = result.meta?.billedUnits?.outputTokens
            ?? result.usage?.billed_units?.output_tokens ?? 0;
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);
        CohereWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user,
            cost,
            aiSystem: CohereWrapper.aiSystem,
            serverAddress: CohereWrapper.serverAddress,
            serverPort: CohereWrapper.serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, requestModel);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        if (ttft > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        }
        if (tbt > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        }
        const finishReason = result.finishReason || result.finish_reason || '';
        if (finishReason) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
        }
        const responseText = result.text ?? '';
        const outputType = typeof responseText === 'string'
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON;
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
        const toolCalls = result.toolCalls || result.message?.tool_calls;
        if (toolCalls && Array.isArray(toolCalls)) {
            const toolNames = toolCalls.map((t) => t.function?.name || t.name || '').filter(Boolean);
            const toolIds = toolCalls.map((t) => t.id || '').filter(Boolean);
            const toolArgs = toolCalls.map((t) => t.function?.arguments || t.arguments || '').filter(Boolean);
            if (toolNames.length > 0) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, toolNames.join(', '));
            }
            if (toolIds.length > 0) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, toolIds.join(', '));
            }
            if (toolArgs.length > 0) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_ARGS, toolArgs.join(', '));
            }
        }
        const toolPlan = result.toolPlan || result.message?.tool_plan;
        if (toolPlan) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_CONTENT_REASONING, toolPlan);
        }
        let inputMessagesJson;
        let outputMessagesJson;
        const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(_tools);
        // Compute system_instructions and version hash regardless of
        // captureContent so versions still group correctly when content
        // capture is disabled.
        const systemInstructionsJson = helpers_1.default.buildSystemInstructionsFromMessages(inputMessages);
        const versionExtras = CohereWrapper._stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: requestModel,
            temperature,
            top_p: topP,
            max_tokens,
        });
        if (captureContent) {
            outputMessagesJson = helpers_1.default.buildOutputMessages(responseText, finishReason || 'stop', toolCalls);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
            inputMessagesJson = helpers_1.default.buildInputMessages(inputMessages);
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
                [semantic_convention_1.default.SERVER_ADDRESS]: CohereWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: CohereWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: responseId,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason || 'stop'],
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: outputType,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
                ...versionExtras,
            };
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
            user,
            cost,
            aiSystem: CohereWrapper.aiSystem,
        };
    }
}
CohereWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_COHERE;
CohereWrapper.serverAddress = 'api.cohere.com';
CohereWrapper.serverPort = 443;
exports.default = CohereWrapper;
//# sourceMappingURL=wrapper.js.map