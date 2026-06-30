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
function spanCreationAttrs(operationName, requestModel, serverAddress, serverPort) {
    return {
        [semantic_convention_1.default.GEN_AI_OPERATION]: operationName,
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_AZURE_AI_INFERENCE,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: serverPort,
    };
}
class AzureAIInferenceWrapper extends base_wrapper_1.default {
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
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_AZURE_AI_INFERENCE,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_AZURE_AI_INFERENCE],
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
    /**
     * Extracts server address and port from an endpoint URL string.
     */
    static parseEndpoint(endpoint) {
        let serverAddress = AzureAIInferenceWrapper.defaultServerAddress;
        let serverPort = AzureAIInferenceWrapper.defaultServerPort;
        try {
            const url = new URL(endpoint);
            serverAddress = url.hostname;
            serverPort = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
        }
        catch { /* use defaults */ }
        return { serverAddress, serverPort };
    }
    // ──────────────────── Chat Completions ────────────────────
    static _patchChatComplete(tracer, serverAddress, serverPort) {
        const genAIEndpoint = 'az.ai.inference.chat.completions';
        return (originalMethod) => {
            return function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const body = args[0]?.body || {};
                const requestModel = body.model || 'gpt-4o';
                const isStream = body.stream === true;
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT, requestModel, serverAddress, serverPort),
                }, effectiveCtx);
                if (isStream) {
                    if (args[0]?.body) {
                        args[0].body.stream_options = { include_usage: true };
                    }
                    const pipelineRequest = api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), () => originalMethod.apply(this, args));
                    const origAsNodeStream = pipelineRequest.asNodeStream?.bind(pipelineRequest);
                    if (origAsNodeStream) {
                        pipelineRequest.asNodeStream = async function (...streamArgs) {
                            try {
                                const streamResp = await origAsNodeStream(...streamArgs);
                                const origBody = streamResp.body;
                                if (!origBody) {
                                    span.end();
                                    return streamResp;
                                }
                                streamResp.body = AzureAIInferenceWrapper._wrapSseStream(origBody, body, genAIEndpoint, span, serverAddress, serverPort);
                                return streamResp;
                            }
                            catch (e) {
                                helpers_1.default.handleException(span, e);
                                base_wrapper_1.default.recordMetrics(span, {
                                    genAIEndpoint,
                                    model: requestModel,
                                    aiSystem: AzureAIInferenceWrapper.aiSystem,
                                    serverAddress,
                                    serverPort,
                                    errorType: e?.constructor?.name || '_OTHER',
                                });
                                span.end();
                                throw e;
                            }
                        };
                    }
                    return pipelineRequest;
                }
                return api_1.context
                    .with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    return originalMethod.apply(this, args);
                })
                    .then((httpResponse) => {
                    return AzureAIInferenceWrapper._chatCompletion({
                        body,
                        genAIEndpoint,
                        httpResponse,
                        span,
                        serverAddress,
                        serverPort,
                    });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: AzureAIInferenceWrapper.aiSystem,
                        serverAddress,
                        serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static async _chatCompletion({ body, genAIEndpoint, httpResponse, span, serverAddress, serverPort, }) {
        let metricParams;
        try {
            const result = httpResponse?.body ?? httpResponse;
            if (result && typeof result === 'object' && result.choices) {
                metricParams = AzureAIInferenceWrapper._chatCompletionCommonSetter({
                    body,
                    genAIEndpoint,
                    result,
                    span,
                    serverAddress,
                    serverPort,
                });
            }
            return httpResponse;
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
    /**
     * Wraps an SSE body stream (Node.js IncomingMessage / ReadableStream) to
     * aggregate telemetry while passing through chunks to the caller.
     * Returns an async-iterable that yields the raw SSE buffers/strings so
     * downstream consumers (e.g. createSseStream) keep working.
     */
    static _wrapSseStream(body, requestBody, genAIEndpoint, span, serverAddress, serverPort) {
        const requestModel = requestBody.model || 'gpt-4o';
        const startTime = Date.now();
        const timestamps = [];
        const aggregated = {
            id: '',
            model: '',
            content: '',
            finishReason: 'stop',
            inputTokens: 0,
            outputTokens: 0,
            toolCalls: [],
        };
        function processSseLine(line) {
            if (!line.startsWith('data: '))
                return;
            const data = line.slice(6).trim();
            if (data === '[DONE]')
                return;
            try {
                const parsed = JSON.parse(data);
                if (parsed.id)
                    aggregated.id = parsed.id;
                if (parsed.model)
                    aggregated.model = parsed.model;
                const choice = parsed.choices?.[0];
                if (choice) {
                    if (choice.delta?.content)
                        aggregated.content += choice.delta.content;
                    if (choice.finish_reason)
                        aggregated.finishReason = choice.finish_reason;
                    if (choice.delta?.tool_calls) {
                        for (const tc of choice.delta.tool_calls) {
                            const idx = tc.index ?? 0;
                            while (aggregated.toolCalls.length <= idx) {
                                aggregated.toolCalls.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
                            }
                            if (tc.id) {
                                aggregated.toolCalls[idx].id = tc.id;
                                aggregated.toolCalls[idx].type = tc.type || 'function';
                                if (tc.function?.name)
                                    aggregated.toolCalls[idx].function.name = tc.function.name;
                                if (tc.function?.arguments)
                                    aggregated.toolCalls[idx].function.arguments = tc.function.arguments;
                            }
                            else if (tc.function?.arguments) {
                                aggregated.toolCalls[idx].function.arguments += tc.function.arguments;
                            }
                        }
                    }
                }
                if (parsed.usage) {
                    aggregated.inputTokens = parsed.usage.prompt_tokens ?? 0;
                    aggregated.outputTokens = parsed.usage.completion_tokens ?? 0;
                }
            }
            catch { /* ignore parse errors */ }
        }
        let pending = '';
        const readable = body;
        const _originalPipe = readable.pipe?.bind(readable);
        const _originalOn = readable.on?.bind(readable);
        const self = AzureAIInferenceWrapper;
        let finalized = false;
        function finalize() {
            if (finalized)
                return;
            finalized = true;
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const diffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = diffs.reduce((a, b) => a + b, 0) / diffs.length / 1000;
            }
            let inputTokens = aggregated.inputTokens;
            let outputTokens = aggregated.outputTokens;
            if (!inputTokens && !outputTokens) {
                const prompt = JSON.stringify(requestBody.messages || []);
                inputTokens = Math.ceil(prompt.length / 2);
                outputTokens = Math.ceil(aggregated.content.length / 2);
            }
            const result = {
                id: aggregated.id,
                model: aggregated.model || requestModel,
                choices: [{
                        finish_reason: aggregated.finishReason,
                        message: {
                            role: 'assistant',
                            content: aggregated.content,
                            ...(aggregated.toolCalls.length > 0 ? { tool_calls: aggregated.toolCalls } : {}),
                        },
                    }],
                usage: {
                    prompt_tokens: inputTokens,
                    completion_tokens: outputTokens,
                },
            };
            const metricParams = self._chatCompletionCommonSetter({
                body: requestBody,
                genAIEndpoint,
                result,
                span,
                serverAddress,
                serverPort,
                ttft,
                tbt,
            });
            span.end();
            base_wrapper_1.default.recordMetrics(span, metricParams);
        }
        if (typeof readable.on === 'function') {
            readable.on('data', (chunk) => {
                timestamps.push(Date.now());
                const text = typeof chunk === 'string' ? chunk : chunk.toString();
                pending += text;
                const lines = pending.split('\n');
                pending = lines.pop() || '';
                for (const line of lines) {
                    processSseLine(line.trim());
                }
            });
            readable.on('end', () => {
                if (pending.trim())
                    processSseLine(pending.trim());
                finalize();
            });
            readable.on('close', () => {
                if (pending.trim())
                    processSseLine(pending.trim());
                finalize();
            });
            readable.on('error', (err) => {
                helpers_1.default.handleException(span, err);
                finalize();
            });
        }
        return readable;
    }
    static _chatCompletionCommonSetter({ body, genAIEndpoint, result, span, serverAddress, serverPort, ttft = 0, tbt = 0, }) {
        const captureContent = config_1.default.captureMessageContent;
        const requestModel = body.model || 'gpt-4o';
        const { messages, frequency_penalty = 0, max_tokens = null, n = 1, presence_penalty = 0, seed = null, stop = null, temperature = 1, top_p, user, stream = false, tools: _tools, } = body;
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
        if (result.id) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, result.id);
        }
        const responseModel = result.model || requestModel;
        const pricingInfo = config_1.default.pricingInfo || {};
        const inputTokens = result.usage?.prompt_tokens || 0;
        const outputTokens = result.usage?.completion_tokens || 0;
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);
        AzureAIInferenceWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user,
            cost,
            aiSystem: AzureAIInferenceWrapper.aiSystem,
            serverAddress,
            serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        if (result.usage?.prompt_tokens_details?.cached_tokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, result.usage.prompt_tokens_details.cached_tokens);
        }
        if (result.usage?.input_tokens_details?.cache_creation_tokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, result.usage.input_tokens_details.cache_creation_tokens);
        }
        if (ttft > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        }
        if (tbt > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        }
        const choices = result.choices || [];
        if (choices[0]?.finish_reason) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [choices[0].finish_reason]);
        }
        const outputType = typeof choices[0]?.message?.content === 'string'
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON;
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
        if (choices[0]?.message?.tool_calls) {
            const toolCalls = choices[0].message.tool_calls;
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
        const versionExtras = AzureAIInferenceWrapper._stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: responseModel || requestModel,
            temperature,
            top_p,
            max_tokens,
        });
        if (captureContent) {
            const toolCalls = choices[0]?.message?.tool_calls;
            outputMessagesJson = helpers_1.default.buildOutputMessages(choices[0]?.message?.content || '', choices[0]?.finish_reason || 'stop', toolCalls);
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
                [semantic_convention_1.default.SERVER_ADDRESS]: serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: result.id,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [choices[0]?.finish_reason || 'stop'],
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
            aiSystem: AzureAIInferenceWrapper.aiSystem,
        };
    }
    // ──────────────────── Embeddings ────────────────────
    static _patchEmbeddings(tracer, serverAddress, serverPort) {
        const genAIEndpoint = 'az.ai.inference.embeddings';
        return (originalMethod) => {
            return function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const body = args[0]?.body || {};
                const requestModel = body.model || 'text-embedding-3-small';
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_EMBEDDING} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_EMBEDDING, requestModel, serverAddress, serverPort),
                }, effectiveCtx);
                return api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    const captureContent = config_1.default.captureMessageContent;
                    let metricParams;
                    try {
                        const httpResponse = await originalMethod.apply(this, args);
                        const responseBody = httpResponse?.body ?? httpResponse;
                        if (responseBody && typeof responseBody === 'object') {
                            const _responseModel = responseBody.model || requestModel;
                            const pricingInfo = config_1.default.pricingInfo || {};
                            const inputTokens = responseBody.usage?.prompt_tokens || 0;
                            const cost = helpers_1.default.getEmbedModelCost(requestModel, pricingInfo, inputTokens);
                            const { encoding_format = 'float', input, dimensions, user } = body;
                            AzureAIInferenceWrapper.setBaseSpanAttributes(span, {
                                genAIEndpoint,
                                model: requestModel,
                                user,
                                cost,
                                aiSystem: AzureAIInferenceWrapper.aiSystem,
                                serverAddress,
                                serverPort,
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
                            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
                            metricParams = {
                                genAIEndpoint,
                                model: requestModel,
                                user,
                                cost,
                                aiSystem: AzureAIInferenceWrapper.aiSystem,
                            };
                        }
                        return httpResponse;
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
AzureAIInferenceWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_AZURE_AI_INFERENCE;
AzureAIInferenceWrapper.defaultServerAddress = 'models.github.ai';
AzureAIInferenceWrapper.defaultServerPort = 443;
exports.default = AzureAIInferenceWrapper;
//# sourceMappingURL=wrapper.js.map