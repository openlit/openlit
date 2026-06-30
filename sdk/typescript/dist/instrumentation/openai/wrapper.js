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
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_OPENAI,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: OpenAIWrapper.serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: OpenAIWrapper.serverPort,
    };
}
class OpenAIWrapper extends base_wrapper_1.default {
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
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_OPENAI,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_OPENAI],
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
        const genAIEndpoint = 'openai.resources.chat.completions';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'gpt-4o';
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
                        return helpers_1.default.createStreamProxy(response, OpenAIWrapper._chatCompletionGenerator({
                            args,
                            genAIEndpoint,
                            response,
                            span,
                        }));
                    }
                    return OpenAIWrapper._chatCompletion({ args, genAIEndpoint, response, span });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: OpenAIWrapper.aiSystem,
                        serverAddress: OpenAIWrapper.serverAddress,
                        serverPort: OpenAIWrapper.serverPort,
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
            metricParams = await OpenAIWrapper._chatCompletionCommonSetter({
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
                system_fingerprint: '',
                service_tier: 'auto',
                choices: [
                    {
                        index: 0,
                        logprobs: null,
                        finish_reason: 'stop',
                        message: { role: 'assistant', content: '' },
                    },
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                    completion_tokens_details: {
                        reasoning_tokens: 0,
                        audio_tokens: 0,
                    },
                    prompt_tokens_details: {
                        cached_tokens: 0,
                        audio_tokens: 0,
                    },
                },
            };
            const toolCalls = [];
            for await (const chunk of response) {
                timestamps.push(Date.now());
                result.id = chunk.id;
                result.created = chunk.created;
                result.model = chunk.model;
                if (chunk.system_fingerprint) {
                    result.system_fingerprint = chunk.system_fingerprint;
                }
                if (chunk.service_tier) {
                    result.service_tier = chunk.service_tier;
                }
                if (chunk.choices[0]?.finish_reason) {
                    result.choices[0].finish_reason = chunk.choices[0].finish_reason;
                }
                if (chunk.choices[0]?.logprobs) {
                    result.choices[0].logprobs = chunk.choices[0].logprobs;
                }
                if (chunk.choices[0]?.delta.content) {
                    result.choices[0].message.content += chunk.choices[0].delta.content;
                }
                if (chunk.choices[0]?.delta.tool_calls) {
                    const deltaTools = chunk.choices[0].delta.tool_calls;
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
                    completion_tokens_details: result.usage.completion_tokens_details,
                    prompt_tokens_details: result.usage.prompt_tokens_details,
                };
            }
            args[0].tools = tools;
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
            }
            metricParams = await OpenAIWrapper._chatCompletionCommonSetter({
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
        const requestModel = args[0]?.model || 'gpt-4o';
        const { messages, frequency_penalty = 0, max_tokens = null, n = 1, presence_penalty = 0, seed = null, stop = null, temperature = 1, top_p, user, stream = false, tools: _tools, service_tier, } = args[0];
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
        if (service_tier && service_tier !== 'auto') {
            span.setAttribute(semantic_convention_1.default.OPENAI_REQUEST_SERVICE_TIER, service_tier);
        }
        if (captureContent) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages(messages || []));
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, result.id);
        const responseModel = result.model || requestModel;
        const pricingInfo = config_1.default.pricingInfo || {};
        // OpenAI reports prompt_tokens inclusive of cached (cache read) tokens, so
        // flag the prompt tokens as cache-inclusive to avoid billing cached tokens
        // twice once a model defines cacheReadPrice.
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, result.usage.prompt_tokens, result.usage.completion_tokens, Number(result.usage.prompt_tokens_details?.cached_tokens) || 0, Number(result.usage.prompt_tokens_details?.cache_creation_tokens) || 0, true);
        OpenAIWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user,
            cost,
            aiSystem: OpenAIWrapper.aiSystem,
            serverAddress: OpenAIWrapper.serverAddress,
            serverPort: OpenAIWrapper.serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        span.setAttribute(semantic_convention_1.default.OPENAI_API_TYPE, 'chat_completions');
        if (result.system_fingerprint) {
            span.setAttribute(semantic_convention_1.default.OPENAI_RESPONSE_SYSTEM_FINGERPRINT, result.system_fingerprint);
        }
        if (result.service_tier) {
            span.setAttribute(semantic_convention_1.default.OPENAI_RESPONSE_SERVICE_TIER, result.service_tier);
        }
        const inputTokens = result.usage.prompt_tokens;
        const outputTokens = result.usage.completion_tokens;
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        if (result.usage.prompt_tokens_details?.cached_tokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, result.usage.prompt_tokens_details.cached_tokens);
        }
        if (result.usage.prompt_tokens_details?.cache_creation_tokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, result.usage.prompt_tokens_details.cache_creation_tokens);
        }
        if (ttft > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        }
        if (tbt > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        }
        if (result.choices[0].finish_reason) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [result.choices[0].finish_reason]);
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
        const versionExtras = OpenAIWrapper._stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: responseModel || requestModel,
            temperature,
            top_p,
            max_tokens,
        });
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
                [semantic_convention_1.default.SERVER_ADDRESS]: OpenAIWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: OpenAIWrapper.serverPort,
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
            aiSystem: OpenAIWrapper.aiSystem,
        };
    }
    static _patchEmbedding(tracer) {
        const genAIEndpoint = 'openai.resources.embeddings';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'text-embedding-ada-002';
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
                        const cost = helpers_1.default.getEmbedModelCost(requestModel, pricingInfo, response.usage.prompt_tokens);
                        const { dimensions, encoding_format = 'float', input, user } = args[0];
                        OpenAIWrapper.setBaseSpanAttributes(span, {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: OpenAIWrapper.aiSystem,
                            serverAddress: OpenAIWrapper.serverAddress,
                            serverPort: OpenAIWrapper.serverPort,
                        });
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_ENCODING_FORMATS, [encoding_format]);
                        if (dimensions) {
                            span.setAttribute(semantic_convention_1.default.GEN_AI_EMBEDDINGS_DIMENSION_COUNT, dimensions);
                        }
                        if (captureContent) {
                            const formattedInput = typeof input === 'string' ? input : JSON.stringify(input);
                            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, formattedInput);
                        }
                        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, response.usage.prompt_tokens);
                        metricParams = {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: OpenAIWrapper.aiSystem,
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
    static _patchFineTune(tracer) {
        const genAIEndpoint = 'openai.resources.fine_tuning.jobs';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'gpt-3.5-turbo';
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FINETUNING} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FINETUNING, requestModel),
                }, effectiveCtx);
                return api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    let metricParams;
                    try {
                        const response = await originalMethod.apply(this, args);
                        const { hyperparameters = {}, suffix = '', training_file, user, validation_file, } = args[0];
                        OpenAIWrapper.setBaseSpanAttributes(span, {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            aiSystem: OpenAIWrapper.aiSystem,
                            serverAddress: OpenAIWrapper.serverAddress,
                            serverPort: OpenAIWrapper.serverPort,
                        });
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TRAINING_FILE, training_file);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_VALIDATION_FILE, validation_file);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FINETUNE_BATCH_SIZE, hyperparameters?.batch_size || 'auto');
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FINETUNE_MODEL_LRM, hyperparameters?.learning_rate_multiplier || 'auto');
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FINETUNE_MODEL_EPOCHS, hyperparameters?.n_epochs || 'auto');
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FINETUNE_MODEL_SUFFIX, suffix);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, response.id);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, response.usage.prompt_tokens);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FINETUNE_STATUS, response.status);
                        metricParams = {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            aiSystem: OpenAIWrapper.aiSystem,
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
    static _patchImageGenerate(tracer) {
        const genAIEndpoint = 'openai.resources.images';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'dall-e-2';
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_IMAGE} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_IMAGE, requestModel),
                }, effectiveCtx);
                return api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    const captureContent = config_1.default.captureMessageContent;
                    let metricParams;
                    try {
                        const response = await originalMethod.apply(this, args);
                        const { prompt, quality = 'standard', response_format = 'url', size = '1024x1024', style = 'vivid', user, } = args[0];
                        const responseModel = response.model || requestModel;
                        const pricingInfo = config_1.default.pricingInfo || {};
                        const cost = (response.data?.length || 1) *
                            helpers_1.default.getImageModelCost(responseModel, pricingInfo, size, quality);
                        OpenAIWrapper.setBaseSpanAttributes(span, {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: OpenAIWrapper.aiSystem,
                            serverAddress: OpenAIWrapper.serverAddress,
                            serverPort: OpenAIWrapper.serverPort,
                        });
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IMAGE_SIZE, size);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IMAGE_QUALITY, quality);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IMAGE_STYLE, style);
                        if (captureContent) {
                            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, prompt);
                        }
                        if (response.data) {
                            const imageUrls = [];
                            const revisedPrompts = [];
                            for (const items of response.data) {
                                revisedPrompts.push(items.revised_prompt || '');
                                const value = items[response_format];
                                imageUrls.push(value && !String(value).startsWith('data:') ? value : '[base64_image_data]');
                            }
                            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_IMAGE, imageUrls);
                            span.setAttribute(semantic_convention_1.default.GEN_AI_CONTENT_REVISED_PROMPT, revisedPrompts);
                        }
                        metricParams = {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: OpenAIWrapper.aiSystem,
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
    static _patchImageVariation(tracer) {
        const genAIEndpoint = 'openai.resources.images';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'dall-e-2';
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_IMAGE} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_IMAGE, requestModel),
                }, effectiveCtx);
                return api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    const captureContent = config_1.default.captureMessageContent;
                    let metricParams;
                    try {
                        const response = await originalMethod.apply(this, args);
                        const { prompt, quality = 'standard', response_format = 'url', size = '1024x1024', style = 'vivid', user, } = args[0];
                        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, response.created);
                        const responseModel = response.model || requestModel;
                        const pricingInfo = config_1.default.pricingInfo || {};
                        const cost = (response.data?.length || 1) *
                            helpers_1.default.getImageModelCost(responseModel, pricingInfo, size, quality);
                        OpenAIWrapper.setBaseSpanAttributes(span, {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: OpenAIWrapper.aiSystem,
                            serverAddress: OpenAIWrapper.serverAddress,
                            serverPort: OpenAIWrapper.serverPort,
                        });
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IMAGE_SIZE, size);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IMAGE_QUALITY, quality);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IMAGE_STYLE, style);
                        if (captureContent) {
                            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, prompt);
                        }
                        if (response.data) {
                            const imageUrls = [];
                            const revisedPrompts = [];
                            for (const items of response.data) {
                                revisedPrompts.push(items.revised_prompt || '');
                                const value = items[response_format];
                                imageUrls.push(value && !String(value).startsWith('data:') ? value : '[base64_image_data]');
                            }
                            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_IMAGE, imageUrls);
                            span.setAttribute(semantic_convention_1.default.GEN_AI_CONTENT_REVISED_PROMPT, revisedPrompts);
                        }
                        metricParams = {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: OpenAIWrapper.aiSystem,
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
    static _patchAudioCreate(tracer) {
        const genAIEndpoint = 'openai.resources.audio.speech';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'tts-1';
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AUDIO} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AUDIO, requestModel),
                }, effectiveCtx);
                return api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    const captureContent = config_1.default.captureMessageContent;
                    let metricParams;
                    try {
                        const response = await originalMethod.apply(this, args);
                        const { input, user, voice, response_format = 'mp3', speed = 1 } = args[0];
                        const responseModel = response.model || requestModel;
                        const pricingInfo = config_1.default.pricingInfo || {};
                        const cost = helpers_1.default.getAudioModelCost(responseModel, pricingInfo, input);
                        OpenAIWrapper.setBaseSpanAttributes(span, {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: OpenAIWrapper.aiSystem,
                            serverAddress: OpenAIWrapper.serverAddress,
                            serverPort: OpenAIWrapper.serverPort,
                        });
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_AUDIO_VOICE, voice);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT, response_format);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_AUDIO_SPEED, speed);
                        if (captureContent) {
                            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, input);
                        }
                        metricParams = {
                            genAIEndpoint,
                            model: requestModel,
                            user,
                            cost,
                            aiSystem: OpenAIWrapper.aiSystem,
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
    static _patchResponsesCreate(tracer) {
        const genAIEndpoint = 'openai.resources.responses';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'gpt-4o';
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
                        return helpers_1.default.createStreamProxy(response, OpenAIWrapper._responsesGenerator({
                            args,
                            genAIEndpoint,
                            response,
                            span,
                        }));
                    }
                    return OpenAIWrapper._responsesComplete({ args, genAIEndpoint, response, span });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: OpenAIWrapper.aiSystem,
                        serverAddress: OpenAIWrapper.serverAddress,
                        serverPort: OpenAIWrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static async _responsesComplete({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        try {
            metricParams = await OpenAIWrapper._responsesCommonSetter({
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
    static async *_responsesGenerator({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        const timestamps = [];
        const startTime = Date.now();
        try {
            const result = {
                id: '',
                model: '',
                service_tier: 'default',
                status: 'completed',
                output: [],
                usage: {
                    input_tokens: 0,
                    output_tokens: 0,
                    output_tokens_details: {
                        reasoning_tokens: 0,
                    },
                },
            };
            let llmResponse = '';
            const responseTools = [];
            for await (const chunk of response) {
                timestamps.push(Date.now());
                if (chunk.type === 'response.output_text.delta') {
                    llmResponse += chunk.delta || '';
                }
                else if (chunk.type === 'response.output_item.added') {
                    const item = chunk.item;
                    if (item?.type === 'function_call') {
                        responseTools.push({
                            id: item.id,
                            call_id: item.call_id,
                            name: item.name,
                            type: item.type,
                            arguments: item.arguments || '',
                            status: item.status,
                        });
                    }
                }
                else if (chunk.type === 'response.function_call_arguments.delta') {
                    const itemId = chunk.item_id;
                    const delta = chunk.delta || '';
                    const tool = responseTools.find(t => t.id === itemId);
                    if (tool) {
                        tool.arguments += delta;
                    }
                }
                else if (chunk.type === 'response.completed') {
                    const responseData = chunk.response;
                    result.id = responseData.id;
                    result.model = responseData.model;
                    result.status = responseData.status;
                    const usage = responseData.usage || {};
                    result.usage.input_tokens = usage.input_tokens || 0;
                    result.usage.output_tokens = usage.output_tokens || 0;
                    result.usage.output_tokens_details.reasoning_tokens =
                        usage.output_tokens_details?.reasoning_tokens || 0;
                }
                yield chunk;
            }
            if (llmResponse) {
                result.output.push({
                    type: 'message',
                    content: [{ type: 'text', text: llmResponse }],
                });
            }
            if (responseTools.length > 0) {
                result.output.push(...responseTools);
            }
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
            }
            metricParams = await OpenAIWrapper._responsesCommonSetter({
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
    static async _responsesCommonSetter({ args, genAIEndpoint, result, span, ttft = 0, tbt = 0, }) {
        const captureContent = config_1.default.captureMessageContent;
        const requestModel = args[0]?.model || 'gpt-4o';
        const { input, temperature = 1.0, top_p = 1.0, max_output_tokens, reasoning, stream = false, instructions, tools: responsesTools, } = args[0];
        const responsesMessages = typeof input === 'string'
            ? [{ role: 'user', content: input }]
            : (Array.isArray(input) ? input : []);
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, temperature);
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, top_p);
        if (max_output_tokens != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, max_output_tokens);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, stream);
        if (reasoning?.effort) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_REASONING_EFFORT, reasoning.effort);
        }
        if (captureContent) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages(responsesMessages));
        }
        const responseModel = result.model || requestModel;
        const pricingInfo = config_1.default.pricingInfo || {};
        const inputTokens = result.usage?.input_tokens || 0;
        const outputTokens = result.usage?.output_tokens || 0;
        // Responses API reports input_tokens inclusive of cached tokens.
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens, Number(result.usage?.input_tokens_details?.cached_tokens) || 0, 0, true);
        OpenAIWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user: '',
            cost,
            aiSystem: OpenAIWrapper.aiSystem,
            serverAddress: OpenAIWrapper.serverAddress,
            serverPort: OpenAIWrapper.serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, result.id);
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [result.status || 'completed']);
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
        span.setAttribute(semantic_convention_1.default.OPENAI_API_TYPE, 'responses');
        if (result.service_tier) {
            span.setAttribute(semantic_convention_1.default.OPENAI_RESPONSE_SERVICE_TIER, result.service_tier);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        if (result.usage?.output_tokens_details?.reasoning_tokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_REASONING_TOKENS, result.usage.output_tokens_details.reasoning_tokens);
        }
        if (ttft > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        }
        if (tbt > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        }
        let completionText = '';
        if (result.output && Array.isArray(result.output)) {
            for (const item of result.output) {
                if (item.type === 'message' && item.content) {
                    for (const content of item.content) {
                        if (content.type === 'text' || content.type === 'output_text') {
                            completionText += content.text || '';
                        }
                    }
                }
            }
        }
        const toolCalls = result.tools || [];
        if (toolCalls.length > 0) {
            const toolNames = toolCalls.map((t) => t.name || '').filter(Boolean);
            const toolIds = toolCalls.map((t) => t.call_id || '').filter(Boolean);
            const toolArgs = toolCalls.map((t) => t.arguments || '').filter(Boolean);
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
        const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(responsesTools);
        const systemInstructionsJson = instructions
            ? JSON.stringify([{ type: 'text', content: String(instructions) }])
            : undefined;
        const versionExtras = OpenAIWrapper._stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: responseModel || requestModel,
            temperature,
            top_p,
            max_tokens: max_output_tokens ?? null,
        });
        if (captureContent) {
            outputMessagesJson = helpers_1.default.buildOutputMessages(completionText, result.status || 'stop');
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
            inputMessagesJson = helpers_1.default.buildInputMessages(responsesMessages);
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
                [semantic_convention_1.default.SERVER_ADDRESS]: OpenAIWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: OpenAIWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: result.id,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [result.status || 'completed'],
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT,
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
            user: '',
            cost,
            aiSystem: OpenAIWrapper.aiSystem,
        };
    }
}
OpenAIWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_OPENAI;
OpenAIWrapper.serverAddress = 'api.openai.com';
OpenAIWrapper.serverPort = 443;
exports.default = OpenAIWrapper;
//# sourceMappingURL=wrapper.js.map