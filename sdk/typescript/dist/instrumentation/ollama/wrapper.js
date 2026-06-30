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
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: OllamaWrapper.aiSystem,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: OllamaWrapper.serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: OllamaWrapper.serverPort,
    };
}
class OllamaWrapper extends base_wrapper_1.default {
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
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_OLLAMA,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_OLLAMA],
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
    // ──────────────────── Chat ────────────────────
    static _patchChat(tracer) {
        const genAIEndpoint = 'ollama.chat';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'llama3';
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
                        return helpers_1.default.createStreamProxy(response, OllamaWrapper._chatGenerator({ args, genAIEndpoint, response, span }));
                    }
                    return OllamaWrapper._chat({ args, genAIEndpoint, response, span });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: OllamaWrapper.aiSystem,
                        serverAddress: OllamaWrapper.serverAddress,
                        serverPort: OllamaWrapper.serverPort,
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
            metricParams = await OllamaWrapper._chatCommonSetter({
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
            const result = {
                model: '',
                message: { role: 'assistant', content: '' },
                done_reason: '',
                prompt_eval_count: 0,
                eval_count: 0,
            };
            let toolCalls = [];
            for await (const chunk of response) {
                timestamps.push(Date.now());
                result.model = chunk.model || result.model;
                if (chunk.message?.content) {
                    result.message.content += chunk.message.content;
                    result.message.role = chunk.message.role || result.message.role;
                }
                if (chunk.message?.tool_calls) {
                    toolCalls = chunk.message.tool_calls;
                }
                if (chunk.done) {
                    result.done_reason = chunk.done_reason || '';
                    result.prompt_eval_count = chunk.prompt_eval_count || 0;
                    result.eval_count = chunk.eval_count || 0;
                }
                yield chunk;
            }
            if (toolCalls.length > 0) {
                result.message.tool_calls = toolCalls;
            }
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
            }
            metricParams = await OllamaWrapper._chatCommonSetter({
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
    static async _chatCommonSetter({ args, genAIEndpoint, result, span, ttft = 0, tbt = 0, }) {
        const captureContent = config_1.default.captureMessageContent;
        const requestModel = args[0]?.model || 'llama3';
        const { messages, stream = false, tools: _tools } = args[0];
        const options = args[0]?.options || {};
        if (options.temperature != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, options.temperature);
        }
        if (options.top_p != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, options.top_p);
        }
        if (options.top_k != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_K, options.top_k);
        }
        if (options.max_tokens != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, options.max_tokens);
        }
        if (options.repeat_penalty) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, options.repeat_penalty);
        }
        if (options.seed != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_SEED, Number(options.seed));
        }
        if (options.stop) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, Array.isArray(options.stop) ? options.stop : [options.stop]);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, stream);
        if (captureContent) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages(messages || []));
        }
        const responseModel = result.model || requestModel;
        const pricingInfo = config_1.default.pricingInfo || {};
        const inputTokens = result.prompt_eval_count || 0;
        const outputTokens = result.eval_count || 0;
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);
        OllamaWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            cost,
            aiSystem: OllamaWrapper.aiSystem,
            serverAddress: OllamaWrapper.serverAddress,
            serverPort: OllamaWrapper.serverPort,
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
        if (result.done_reason) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [result.done_reason]);
        }
        const outputType = typeof result.message?.content === 'string'
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON;
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
        if (result.message?.tool_calls) {
            const resultToolCalls = result.message.tool_calls;
            const toolNames = resultToolCalls.map((t) => t.function?.name || '').filter(Boolean);
            const toolIds = resultToolCalls.map((t) => String(t.id || '')).filter(Boolean);
            const toolArgs = resultToolCalls
                .map((t) => String(t.function?.arguments || ''))
                .filter(Boolean);
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
        const versionExtras = OllamaWrapper._stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: responseModel || requestModel,
            temperature: options.temperature ?? null,
            top_p: options.top_p ?? null,
            max_tokens: options.max_tokens ?? null,
        });
        if (captureContent) {
            const toolCalls = result.message?.tool_calls;
            outputMessagesJson = helpers_1.default.buildOutputMessages(result.message?.content || '', result.done_reason || 'stop', toolCalls);
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
                [semantic_convention_1.default.SERVER_ADDRESS]: OllamaWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: OllamaWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [result.done_reason || 'stop'],
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
            cost,
            aiSystem: OllamaWrapper.aiSystem,
        };
    }
    // ──────────────────── Generate (text_completion) ────────────────────
    static _patchGenerate(tracer) {
        const genAIEndpoint = 'ollama.generate';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'llama3';
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, requestModel),
                }, effectiveCtx);
                return api_1.context
                    .with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    return originalMethod.apply(this, args);
                })
                    .then((response) => {
                    const { stream = false } = args[0];
                    if (stream) {
                        return helpers_1.default.createStreamProxy(response, OllamaWrapper._generateGenerator({ args, genAIEndpoint, response, span }));
                    }
                    return OllamaWrapper._generate({ args, genAIEndpoint, response, span });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: OllamaWrapper.aiSystem,
                        serverAddress: OllamaWrapper.serverAddress,
                        serverPort: OllamaWrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static async _generate({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        try {
            metricParams = await OllamaWrapper._generateCommonSetter({
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
    static async *_generateGenerator({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        const timestamps = [];
        const startTime = Date.now();
        try {
            const result = {
                model: '',
                response: '',
                done_reason: '',
                prompt_eval_count: 0,
                eval_count: 0,
            };
            for await (const chunk of response) {
                timestamps.push(Date.now());
                result.model = chunk.model || result.model;
                if (chunk.response) {
                    result.response += chunk.response;
                }
                if (chunk.done) {
                    result.done_reason = chunk.done_reason || '';
                    result.prompt_eval_count = chunk.prompt_eval_count || 0;
                    result.eval_count = chunk.eval_count || 0;
                }
                yield chunk;
            }
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
            }
            metricParams = await OllamaWrapper._generateCommonSetter({
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
    static async _generateCommonSetter({ args, genAIEndpoint, result, span, ttft = 0, tbt = 0, }) {
        const captureContent = config_1.default.captureMessageContent;
        const requestModel = args[0]?.model || 'llama3';
        const { prompt, stream = false } = args[0];
        const options = args[0]?.options || {};
        if (options.temperature != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, options.temperature);
        }
        if (options.top_p != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, options.top_p);
        }
        if (options.top_k != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_K, options.top_k);
        }
        if (options.max_tokens != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, options.max_tokens);
        }
        if (options.repeat_penalty) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, options.repeat_penalty);
        }
        if (options.seed != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_SEED, Number(options.seed));
        }
        if (options.stop) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, Array.isArray(options.stop) ? options.stop : [options.stop]);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, stream);
        if (captureContent) {
            const inputMessages = [{ role: 'user', content: prompt || '' }];
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages(inputMessages));
        }
        const responseModel = result.model || requestModel;
        const pricingInfo = config_1.default.pricingInfo || {};
        const inputTokens = result.prompt_eval_count || 0;
        const outputTokens = result.eval_count || 0;
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);
        OllamaWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            cost,
            aiSystem: OllamaWrapper.aiSystem,
            serverAddress: OllamaWrapper.serverAddress,
            serverPort: OllamaWrapper.serverPort,
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
        if (result.done_reason) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [result.done_reason]);
        }
        const llmResponse = result.response || '';
        const outputType = typeof llmResponse === 'string'
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON;
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
        let inputMessagesJson;
        let outputMessagesJson;
        if (captureContent) {
            const inputMessages = [{ role: 'user', content: prompt || '' }];
            outputMessagesJson = helpers_1.default.buildOutputMessages(llmResponse, result.done_reason || 'stop');
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
            inputMessagesJson = helpers_1.default.buildInputMessages(inputMessages);
        }
        const versionExtras = OllamaWrapper._stampAgentVersion(span, {
            primaryModel: responseModel || requestModel,
            temperature: options.temperature ?? null,
            top_p: options.top_p ?? null,
            max_tokens: options.max_tokens ?? null,
        });
        if (!config_1.default.disableEvents) {
            const eventAttrs = {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: responseModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: OllamaWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: OllamaWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [result.done_reason || 'stop'],
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
            }
            helpers_1.default.emitInferenceEvent(span, eventAttrs);
        }
        return {
            genAIEndpoint,
            model: requestModel,
            cost,
            aiSystem: OllamaWrapper.aiSystem,
        };
    }
    // ──────────────────── Embeddings ────────────────────
    static _patchEmbeddings(tracer) {
        const genAIEndpoint = 'ollama.embeddings';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'llama3';
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
                        const promptVal = args[0]?.input || args[0]?.prompt || '';
                        const promptText = typeof promptVal === 'string' ? promptVal : JSON.stringify(promptVal);
                        const inputTokens = helpers_1.default.generalTokens(promptText);
                        const pricingInfo = config_1.default.pricingInfo || {};
                        const cost = helpers_1.default.getEmbedModelCost(requestModel, pricingInfo, inputTokens);
                        OllamaWrapper.setBaseSpanAttributes(span, {
                            genAIEndpoint,
                            model: requestModel,
                            cost,
                            aiSystem: OllamaWrapper.aiSystem,
                            serverAddress: OllamaWrapper.serverAddress,
                            serverPort: OllamaWrapper.serverPort,
                        });
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
                        if (captureContent) {
                            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, promptText);
                        }
                        metricParams = {
                            genAIEndpoint,
                            model: requestModel,
                            cost,
                            aiSystem: OllamaWrapper.aiSystem,
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
OllamaWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_OLLAMA;
OllamaWrapper.serverAddress = '127.0.0.1';
OllamaWrapper.serverPort = 11434;
exports.default = OllamaWrapper;
//# sourceMappingURL=wrapper.js.map