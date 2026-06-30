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
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: MistralWrapper.aiSystem,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: MistralWrapper.serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: MistralWrapper.serverPort,
    };
}
class MistralWrapper extends base_wrapper_1.default {
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
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_MISTRAL,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_MISTRAL],
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
    static _patchChatCompletionCreate(tracer) {
        const genAIEndpoint = 'mistral.chat.completions';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'mistral-small-latest';
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
                    const isStream = args[0]?.stream === true || typeof response[Symbol.asyncIterator] === 'function';
                    if (isStream) {
                        return helpers_1.default.createStreamProxy(response, MistralWrapper._chatCompletionGenerator({
                            args,
                            genAIEndpoint,
                            response,
                            span,
                        }));
                    }
                    return MistralWrapper._chatCompletion({ args, genAIEndpoint, response, span });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: MistralWrapper.aiSystem,
                        serverAddress: MistralWrapper.serverAddress,
                        serverPort: MistralWrapper.serverPort,
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
            metricParams = await MistralWrapper._chatCompletionCommonSetter({
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
            let { tools } = args[0];
            const result = {
                id: '0',
                created: -1,
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
            const toolCalls = [];
            for await (const chunk of response) {
                timestamps.push(Date.now());
                const chunkData = chunk.data ?? chunk;
                result.id = chunkData.id || result.id;
                result.created = chunkData.created || result.created;
                result.model = chunkData.model || result.model;
                if (chunkData.choices && chunkData.choices[0]) {
                    const chunkFinishReason = chunkData.choices[0].finishReason ?? chunkData.choices[0].finish_reason;
                    if (chunkFinishReason) {
                        result.choices[0].finish_reason = chunkFinishReason;
                    }
                    const delta = chunkData.choices[0].delta;
                    if (delta?.content) {
                        result.choices[0].message.content += delta.content;
                    }
                    if (delta?.toolCalls || delta?.tool_calls) {
                        const deltaTools = delta.toolCalls || delta.tool_calls;
                        for (const tool of deltaTools) {
                            const idx = tool.index || 0;
                            while (toolCalls.length <= idx) {
                                toolCalls.push({
                                    id: '',
                                    type: 'function',
                                    function: { name: '', arguments: '' }
                                });
                            }
                            if (tool.id) {
                                toolCalls[idx].id = tool.id;
                                toolCalls[idx].type = tool.type || 'function';
                                if (tool.function?.name) {
                                    toolCalls[idx].function.name = tool.function.name;
                                }
                                if (tool.function?.arguments) {
                                    toolCalls[idx].function.arguments = tool.function.arguments;
                                }
                            }
                            else if (tool.function?.arguments) {
                                toolCalls[idx].function.arguments += tool.function.arguments;
                            }
                        }
                        tools = true;
                    }
                }
                yield chunk;
            }
            if (toolCalls.length > 0) {
                result.choices[0].message = {
                    ...result.choices[0].message,
                    tool_calls: toolCalls
                };
            }
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
            args[0].tools = tools;
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
            }
            metricParams = await MistralWrapper._chatCompletionCommonSetter({
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
        const requestModel = args[0]?.model || 'mistral-small-latest';
        const { messages, frequency_penalty = 0, max_tokens = null, n = 1, presence_penalty = 0, seed = null, stop = null, temperature = 1, top_p, user, stream = false, tools: _tools, } = args[0];
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, top_p || 1);
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
        const promptTokens = result.usage?.promptTokens ?? result.usage?.prompt_tokens ?? 0;
        const completionTokens = result.usage?.completionTokens ?? result.usage?.completion_tokens ?? 0;
        const responseModel = result.model || requestModel;
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, promptTokens, completionTokens);
        MistralWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user,
            cost,
            aiSystem: MistralWrapper.aiSystem,
            serverAddress: MistralWrapper.serverAddress,
            serverPort: MistralWrapper.serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        const inputTokens = promptTokens;
        const outputTokens = completionTokens;
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        if (ttft > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        }
        if (tbt > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        }
        const finishReason = result.choices[0].finishReason ?? result.choices[0].finish_reason;
        if (finishReason) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
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
        // Compute system_instructions and version hash regardless of
        // captureContent so versions still group correctly when content
        // capture is disabled.
        const systemInstructionsJson = helpers_1.default.buildSystemInstructionsFromMessages(messages || []);
        const versionExtras = MistralWrapper._stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: responseModel || requestModel,
            temperature,
            top_p,
            max_tokens,
        });
        if (captureContent) {
            const toolCalls = result.choices[0].message.tool_calls;
            outputMessagesJson = helpers_1.default.buildOutputMessages(result.choices[0].message.content || '', finishReason || 'stop', toolCalls);
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
                [semantic_convention_1.default.SERVER_ADDRESS]: MistralWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: MistralWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: result.id,
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
            aiSystem: MistralWrapper.aiSystem,
        };
    }
    static _patchEmbedding(tracer) {
        const genAIEndpoint = 'mistral.embeddings';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'mistral-embed';
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
                        const promptTokens = response.usage?.promptTokens ?? response.usage?.prompt_tokens ?? 0;
                        const cost = helpers_1.default.getEmbedModelCost(requestModel, pricingInfo, promptTokens);
                        const { input, inputs, user, encoding_format = 'float' } = args[0];
                        const embeddingInput = input ?? inputs;
                        MistralWrapper.setBaseSpanAttributes(span, {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: MistralWrapper.aiSystem,
                            serverAddress: MistralWrapper.serverAddress,
                            serverPort: MistralWrapper.serverPort,
                        });
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_ENCODING_FORMATS, [encoding_format]);
                        if (captureContent && embeddingInput) {
                            const formattedInput = typeof embeddingInput === 'string' ? embeddingInput : JSON.stringify(embeddingInput);
                            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, formattedInput);
                        }
                        const embData = response?.data;
                        if (Array.isArray(embData) && embData.length > 0 && Array.isArray(embData[0].embedding)) {
                            span.setAttribute(semantic_convention_1.default.GEN_AI_EMBEDDINGS_DIMENSION_COUNT, embData[0].embedding.length);
                        }
                        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
                        metricParams = {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: MistralWrapper.aiSystem,
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
}
MistralWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_MISTRAL;
MistralWrapper.serverAddress = 'api.mistral.ai';
MistralWrapper.serverPort = 443;
exports.default = MistralWrapper;
//# sourceMappingURL=wrapper.js.map