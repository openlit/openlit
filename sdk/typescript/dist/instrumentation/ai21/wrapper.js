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
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: AI21Wrapper.aiSystem,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: AI21Wrapper.serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: AI21Wrapper.serverPort,
    };
}
class AI21Wrapper extends base_wrapper_1.default {
    static _patchChatCompletionCreate(tracer) {
        const genAIEndpoint = 'ai21.chat.completions';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'jamba-mini';
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
                    const { stream = false } = args[0];
                    if (stream) {
                        return helpers_1.default.createStreamProxy(response, AI21Wrapper._chatCompletionGenerator({
                            args,
                            genAIEndpoint,
                            response,
                            span,
                        }));
                    }
                    return AI21Wrapper._chatCompletion({ args, genAIEndpoint, response, span });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: AI21Wrapper.aiSystem,
                        serverAddress: AI21Wrapper.serverAddress,
                        serverPort: AI21Wrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static async _chatCompletion({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        try {
            metricParams = await AI21Wrapper._chatCompletionCommonSetter({
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
    static async *_chatCompletionGenerator({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        const timestamps = [];
        const startTime = Date.now();
        try {
            const { messages } = args[0];
            const result = {
                id: '0',
                model: '',
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: { role: 'assistant', content: '' },
                    },
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                },
            };
            for await (const chunk of response) {
                timestamps.push(Date.now());
                if (chunk.id) {
                    result.id = chunk.id;
                }
                // AI21 stream chunks currently carry no `model`, so this is defensive:
                // keep streaming aligned with the non-streaming path (which also falls
                // back to the request model) if the API ever starts emitting one.
                if (chunk.model && !result.model) {
                    result.model = chunk.model;
                }
                if (chunk.choices?.[0]?.finish_reason) {
                    result.choices[0].finish_reason = chunk.choices[0].finish_reason;
                }
                if (chunk.choices?.[0]?.delta?.content) {
                    result.choices[0].message.content += chunk.choices[0].delta.content;
                }
                // AI21 emits usage on the final chunk (UsageInfo), unlike groq's x_groq.usage.
                if (chunk.usage) {
                    result.usage.prompt_tokens = chunk.usage.prompt_tokens || 0;
                    result.usage.completion_tokens = chunk.usage.completion_tokens || 0;
                    result.usage.total_tokens = chunk.usage.total_tokens || 0;
                }
                yield chunk;
            }
            // Fall back to local token counting if the stream did not report usage.
            if (!result.usage.prompt_tokens && !result.usage.completion_tokens) {
                let promptTokens = 0;
                for (const message of messages || []) {
                    promptTokens += helpers_1.default.openaiTokens(message.content, result.model) ?? 0;
                }
                const completionTokens = helpers_1.default.openaiTokens(result.choices[0].message.content ?? '', result.model);
                if (completionTokens) {
                    result.usage = {
                        prompt_tokens: promptTokens,
                        completion_tokens: completionTokens,
                        total_tokens: promptTokens + completionTokens,
                    };
                }
            }
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
            }
            metricParams = await AI21Wrapper._chatCompletionCommonSetter({
                args,
                genAIEndpoint,
                result,
                span,
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
    static async _chatCompletionCommonSetter({ args, genAIEndpoint, result, span, ttft = 0, tbt = 0, }) {
        const captureContent = config_1.default.captureMessageContent;
        const requestModel = args[0]?.model || 'jamba-mini';
        const { messages, max_tokens = null, n = 1, stop = null, temperature = 1, top_p, user, stream = false, tools: _tools, } = args[0];
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, top_p ?? 1);
        if (max_tokens != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, temperature);
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, stream);
        if (stop) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, Array.isArray(stop) ? stop : [stop]);
        }
        if (n && n !== 1) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_CHOICE_COUNT, n);
        }
        if (captureContent) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages(messages || []));
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, result.id);
        const responseModel = result.model || requestModel;
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, result.usage.prompt_tokens, result.usage.completion_tokens);
        AI21Wrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user,
            cost,
            aiSystem: AI21Wrapper.aiSystem,
            serverAddress: AI21Wrapper.serverAddress,
            serverPort: AI21Wrapper.serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        const inputTokens = result.usage.prompt_tokens;
        const outputTokens = result.usage.completion_tokens;
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        if (ttft > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        }
        if (tbt > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        }
        if (result.choices[0].finish_reason) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [
                result.choices[0].finish_reason,
            ]);
        }
        const outputType = typeof result.choices[0].message.content === 'string'
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON;
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
        if (result.choices[0].message.tool_calls) {
            const toolCalls = result.choices[0].message.tool_calls;
            const toolNames = toolCalls.map((t) => t.function?.name || '').filter(Boolean);
            const toolIds = toolCalls.map((t) => t.id || '').filter(Boolean);
            const toolArgs = toolCalls.map((t) => t.function?.arguments || '').filter(Boolean);
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
        let inputMessagesJson;
        let outputMessagesJson;
        const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(_tools);
        // Always extract system_instructions so the version hash can be computed
        // even when content capture is disabled.
        const systemInstructionsJson = helpers_1.default.buildSystemInstructionsFromMessages(messages || []);
        const versionExtras = {};
        try {
            const versionHash = helpers_1.default.computeAgentVersionHash({
                systemInstructions: systemInstructionsJson ?? null,
                toolDefinitions: toolDefinitionsJson ?? null,
                primaryModel: responseModel || requestModel,
                runtimeConfig: {
                    temperature: temperature ?? null,
                    top_p: top_p ?? null,
                    max_tokens: max_tokens ?? null,
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_AI21,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_AI21],
            });
            if (versionHash) {
                versionExtras[semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH] = versionHash;
                span.setAttribute(semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH, versionHash);
            }
        }
        catch {
            // Never fail the wrapped call on hash issues.
        }
        const versionLabel = (0, helpers_1.getCurrentAgentVersion)();
        if (versionLabel) {
            versionExtras[semantic_convention_1.default.GEN_AI_AGENT_VERSION] = versionLabel;
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_VERSION, versionLabel);
        }
        if (captureContent) {
            const toolCalls = result.choices[0].message.tool_calls;
            outputMessagesJson = helpers_1.default.buildOutputMessages(result.choices[0].message.content || '', result.choices[0].finish_reason || 'stop', toolCalls);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
            inputMessagesJson = helpers_1.default.buildInputMessages(messages || []);
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
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: responseModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: AI21Wrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: AI21Wrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: result.id,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [result.choices[0].finish_reason],
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: outputType,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
                ...versionExtras,
            };
            if (captureContent) {
                if (inputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
                if (systemInstructionsJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS] = systemInstructionsJson;
                if (outputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
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
            aiSystem: AI21Wrapper.aiSystem,
        };
    }
    // --- Conversational RAG ---------------------------------------------------
    // Mirrors the Python reference (ai21/ai21.py chat_rag + utils.py
    // common_chat_rag_logic). The RAG surface is never streamed, responses carry
    // no `model` and no usage token counts (counted locally), and the answer is
    // at `choices[i].content` (flat) rather than `choices[i].message.content`.
    static _patchConversationalRagCreate(tracer) {
        const genAIEndpoint = 'ai21.conversational_rag';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'jamba-1.5-mini';
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
                    return AI21Wrapper._chatRag({ args, genAIEndpoint, response, span });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: AI21Wrapper.aiSystem,
                        serverAddress: AI21Wrapper.serverAddress,
                        serverPort: AI21Wrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static async _chatRag({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        try {
            metricParams = await AI21Wrapper._chatRagCommonSetter({
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
    static async _chatRagCommonSetter({ args, genAIEndpoint, result, span, }) {
        const captureContent = config_1.default.captureMessageContent;
        const requestModel = args[0]?.model || 'jamba-1.5-mini';
        const { messages, n = 1, user, max_segments, retrieval_strategy, max_neighbors, file_ids, path, retrieval_similarity_threshold, tools: _tools, } = args[0];
        // RAG choices are flat ChatMessage objects (`content` on the choice).
        const choices = result.choices || [];
        let llmResponse = '';
        for (let i = 0; i < n; i++) {
            llmResponse += choices[i]?.content ?? '';
        }
        // RAG responses report no usage; count tokens locally (mirrors Python
        // general_tokens over the formatted prompt and the aggregated answer).
        let inputTokens = 0;
        for (const message of messages || []) {
            inputTokens += helpers_1.default.openaiTokens(message.content, requestModel) ?? 0;
        }
        const outputTokens = helpers_1.default.openaiTokens(llmResponse, requestModel) ?? 0;
        const responseModel = requestModel;
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);
        AI21Wrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user,
            cost,
            aiSystem: AI21Wrapper.aiSystem,
            serverAddress: AI21Wrapper.serverAddress,
            serverPort: AI21Wrapper.serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
        // RAG-specific attributes (defaults mirror the Python implementation).
        span.setAttribute(semantic_convention_1.default.GEN_AI_RAG_MAX_SEGMENTS, max_segments ?? -1);
        span.setAttribute(semantic_convention_1.default.GEN_AI_RAG_STRATEGY, retrieval_strategy ?? 'segments');
        span.setAttribute(semantic_convention_1.default.GEN_AI_RAG_MAX_NEIGHBORS, max_neighbors ?? -1);
        span.setAttribute(semantic_convention_1.default.GEN_AI_RAG_FILE_IDS, file_ids != null ? String(file_ids) : '');
        span.setAttribute(semantic_convention_1.default.GEN_AI_RAG_DOCUMENTS_PATH, path ?? '');
        span.setAttribute(semantic_convention_1.default.GEN_AI_RAG_SIMILARITY_THRESHOLD, retrieval_similarity_threshold ?? -1);
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, result.id);
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        const outputType = typeof llmResponse === 'string'
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON;
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
        let inputMessagesJson;
        let outputMessagesJson;
        const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(_tools);
        if (captureContent) {
            inputMessagesJson = helpers_1.default.buildInputMessages(messages || []);
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
            outputMessagesJson = helpers_1.default.buildOutputMessages(llmResponse, 'stop', undefined);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
        }
        if (toolDefinitionsJson) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
        }
        if (!config_1.default.disableEvents) {
            const eventAttrs = {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: responseModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: AI21Wrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: AI21Wrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: result.id,
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: outputType,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
            };
            if (captureContent) {
                if (inputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
                if (outputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
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
            aiSystem: AI21Wrapper.aiSystem,
        };
    }
}
AI21Wrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_AI21;
AI21Wrapper.serverAddress = 'api.ai21.com';
AI21Wrapper.serverPort = 443;
exports.default = AI21Wrapper;
//# sourceMappingURL=wrapper.js.map