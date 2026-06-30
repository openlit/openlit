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
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: VercelAIWrapper.aiSystem,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: VercelAIWrapper.serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: VercelAIWrapper.serverPort,
    };
}
class VercelAIWrapper extends base_wrapper_1.default {
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
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_VERCEL_AI,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_VERCEL_AI],
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
    static _patchGenerateText(tracer) {
        const genAIEndpoint = 'vercel_ai.generateText';
        return (originalMethod) => {
            return async function (...args) {
                const params = args[0] || {};
                const modelId = params.model?.modelId || 'unknown';
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT} ${modelId}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT, modelId),
                });
                return api_1.context
                    .with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    return originalMethod.apply(this, args);
                })
                    .then((response) => {
                    return VercelAIWrapper._chatComplete({
                        args,
                        genAIEndpoint,
                        response,
                        span,
                        outputType: semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT,
                    });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: modelId,
                        aiSystem: VercelAIWrapper.aiSystem,
                        serverAddress: VercelAIWrapper.serverAddress,
                        serverPort: VercelAIWrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static _patchStreamText(tracer) {
        const genAIEndpoint = 'vercel_ai.streamText';
        return (originalMethod) => {
            return async function (...args) {
                const params = args[0] || {};
                const modelId = params.model?.modelId || 'unknown';
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT} ${modelId}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT, modelId),
                });
                const startTime = Date.now();
                const chunkTimestamps = [];
                try {
                    const response = await api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => originalMethod.apply(this, args));
                    try {
                        const originalTextStream = response.textStream;
                        if (originalTextStream && typeof originalTextStream.getReader === 'function') {
                            const reader = originalTextStream.getReader();
                            const wrappedTextStream = new ReadableStream({
                                async pull(controller) {
                                    const { done, value } = await reader.read();
                                    if (done) {
                                        controller.close();
                                    }
                                    else {
                                        chunkTimestamps.push(Date.now());
                                        controller.enqueue(value);
                                    }
                                },
                                cancel() {
                                    reader.cancel();
                                },
                            });
                            Object.defineProperty(response, 'textStream', {
                                value: wrappedTextStream,
                                writable: true,
                                configurable: true,
                            });
                        }
                    }
                    catch (_) {
                        // Stream interception is best-effort; TTFT/TBT won't be captured
                    }
                    Promise.resolve(response.usage)
                        .then(async (usage) => {
                        let metricParams;
                        try {
                            const ttft = chunkTimestamps.length > 0 ? (chunkTimestamps[0] - startTime) / 1000 : 0;
                            let tbt = 0;
                            if (chunkTimestamps.length > 1) {
                                const timeDiffs = chunkTimestamps.slice(1).map((t, i) => t - chunkTimestamps[i]);
                                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
                            }
                            const finishReason = await Promise.resolve(response.finishReason).catch(() => 'stop');
                            const text = await Promise.resolve(response.text).catch(() => '');
                            const toolCalls = await Promise.resolve(response.toolCalls).catch(() => undefined);
                            const responseDetails = await Promise.resolve(response.response).catch(() => undefined);
                            const result = {
                                usage: {
                                    promptTokens: usage?.promptTokens || 0,
                                    completionTokens: usage?.completionTokens || 0,
                                },
                                finishReason: finishReason || 'stop',
                                text: text || '',
                                toolCalls,
                                response: responseDetails,
                            };
                            metricParams = await VercelAIWrapper._chatCommonSetter({
                                args,
                                genAIEndpoint,
                                result,
                                span,
                                isStream: true,
                                outputType: semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT,
                                ttft,
                                tbt,
                            });
                        }
                        catch (e) {
                            helpers_1.default.handleException(span, e);
                        }
                        finally {
                            span.end();
                            if (metricParams) {
                                base_wrapper_1.default.recordMetrics(span, metricParams);
                            }
                        }
                    })
                        .catch((e) => {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint,
                            model: modelId,
                            aiSystem: VercelAIWrapper.aiSystem,
                            serverAddress: VercelAIWrapper.serverAddress,
                            serverPort: VercelAIWrapper.serverPort,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
                        span.end();
                    });
                    return response;
                }
                catch (e) {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: modelId,
                        aiSystem: VercelAIWrapper.aiSystem,
                        serverAddress: VercelAIWrapper.serverAddress,
                        serverPort: VercelAIWrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                }
            };
        };
    }
    static _patchGenerateObject(tracer) {
        const genAIEndpoint = 'vercel_ai.generateObject';
        return (originalMethod) => {
            return async function (...args) {
                const params = args[0] || {};
                const modelId = params.model?.modelId || 'unknown';
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT} ${modelId}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT, modelId),
                });
                return api_1.context
                    .with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    return originalMethod.apply(this, args);
                })
                    .then((response) => {
                    const result = {
                        ...response,
                        text: JSON.stringify(response.object || {}),
                    };
                    return VercelAIWrapper._chatComplete({
                        args,
                        genAIEndpoint,
                        response,
                        span,
                        outputType: semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON,
                        resultOverride: result,
                    });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: modelId,
                        aiSystem: VercelAIWrapper.aiSystem,
                        serverAddress: VercelAIWrapper.serverAddress,
                        serverPort: VercelAIWrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static _patchEmbed(tracer) {
        const genAIEndpoint = 'vercel_ai.embed';
        return (originalMethod) => {
            return async function (...args) {
                const params = args[0] || {};
                const modelId = params.model?.modelId || 'unknown';
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_EMBEDDING} ${modelId}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_EMBEDDING, modelId),
                });
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    const captureContent = config_1.default.captureMessageContent;
                    let metricParams;
                    try {
                        const response = await originalMethod.apply(this, args);
                        const pricingInfo = config_1.default.pricingInfo || {};
                        const inputTokens = response.usage?.tokens || 0;
                        const cost = helpers_1.default.getEmbedModelCost(modelId, pricingInfo, inputTokens);
                        VercelAIWrapper.setBaseSpanAttributes(span, {
                            genAIEndpoint,
                            model: modelId,
                            cost,
                            aiSystem: VercelAIWrapper.aiSystem,
                            serverAddress: VercelAIWrapper.serverAddress,
                            serverPort: VercelAIWrapper.serverPort,
                        });
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
                        if (captureContent && params.value !== undefined) {
                            const inputStr = typeof params.value === 'string' ? params.value : JSON.stringify(params.value);
                            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, inputStr);
                        }
                        metricParams = {
                            genAIEndpoint,
                            model: modelId,
                            cost,
                            aiSystem: VercelAIWrapper.aiSystem,
                            serverAddress: VercelAIWrapper.serverAddress,
                            serverPort: VercelAIWrapper.serverPort,
                        };
                        return response;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        metricParams = {
                            genAIEndpoint,
                            model: modelId,
                            aiSystem: VercelAIWrapper.aiSystem,
                            serverAddress: VercelAIWrapper.serverAddress,
                            serverPort: VercelAIWrapper.serverPort,
                            errorType: e?.constructor?.name || '_OTHER',
                        };
                        throw e;
                    }
                    finally {
                        span.end();
                        if (metricParams)
                            base_wrapper_1.default.recordMetrics(span, metricParams);
                    }
                });
            };
        };
    }
    static async _chatComplete({ args, genAIEndpoint, response, span, outputType, resultOverride, }) {
        let metricParams;
        try {
            metricParams = await VercelAIWrapper._chatCommonSetter({
                args,
                genAIEndpoint,
                result: resultOverride || response,
                span,
                isStream: false,
                outputType,
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
    static async _chatCommonSetter({ args, genAIEndpoint, result, span, isStream, outputType, ttft = 0, tbt = 0, }) {
        const captureContent = config_1.default.captureMessageContent;
        const params = args[0] || {};
        const modelId = params.model?.modelId || 'unknown';
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, params.temperature ?? 1);
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, params.topP ?? 1);
        if (params.maxTokens != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, params.maxTokens);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, isStream);
        if (params.seed != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_SEED, Number(params.seed));
        }
        if (params.frequencyPenalty) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, params.frequencyPenalty);
        }
        if (params.presencePenalty) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, params.presencePenalty);
        }
        if (params.stopSequences) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, Array.isArray(params.stopSequences) ? params.stopSequences : [params.stopSequences]);
        }
        if (params.topK != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_K, params.topK);
        }
        const messages = params.messages || (params.prompt ? [{ role: 'user', content: params.prompt }] : []);
        if (captureContent) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages(messages, params.system));
        }
        const responseId = result.response?.id;
        const responseModel = result.response?.modelId || modelId;
        const inputTokens = result.usage?.promptTokens || 0;
        const outputTokens = result.usage?.completionTokens || 0;
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = helpers_1.default.getChatModelCost(modelId, pricingInfo, inputTokens, outputTokens);
        VercelAIWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: modelId,
            cost,
            aiSystem: VercelAIWrapper.aiSystem,
            serverAddress: VercelAIWrapper.serverAddress,
            serverPort: VercelAIWrapper.serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        if (responseId) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, responseId);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        const finishReason = result.finishReason || 'stop';
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
        if (ttft > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        }
        if (tbt > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        }
        if (result.toolCalls?.length > 0) {
            const toolNames = result.toolCalls.map((t) => t.toolName || '').filter(Boolean);
            const toolIds = result.toolCalls.map((t) => t.toolCallId || '').filter(Boolean);
            const toolArgs = result.toolCalls.map((t) => JSON.stringify(t.args || {})).filter(Boolean);
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
        const normalizedToolCalls = result.toolCalls?.map((t) => ({
            id: t.toolCallId || '',
            name: t.toolName || '',
            arguments: t.args || {},
        }));
        // Vercel AI `tools` is an object map keyed by tool name: { toolName: { description, parameters } }
        // Normalize to the flat array shape that buildToolDefinitions understands.
        let toolsForDefinitions = params.tools;
        if (toolsForDefinitions && !Array.isArray(toolsForDefinitions) && typeof toolsForDefinitions === 'object') {
            toolsForDefinitions = Object.entries(toolsForDefinitions).map(([name, def]) => ({
                name,
                description: def?.description ?? '',
                parameters: def?.parameters ?? def?.inputSchema ?? {},
            }));
        }
        const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(toolsForDefinitions);
        let inputMessagesJson;
        let outputMessagesJson;
        // Compute system_instructions JSON regardless of captureContent so the
        // version hash is stable across runs even when content capture is off.
        // Vercel AI exposes the system prompt either via a top-level `system`
        // field or as a `{ role: 'system' }` message in the `messages` array.
        const systemInstructionsJson = params.system
            ? JSON.stringify([{ type: 'text', content: String(params.system) }])
            : helpers_1.default.buildSystemInstructionsFromMessages(messages);
        const versionExtras = VercelAIWrapper._stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: responseModel || modelId,
            temperature: typeof params.temperature === 'number' ? params.temperature : null,
            top_p: typeof params.topP === 'number' ? params.topP : null,
            max_tokens: typeof params.maxTokens === 'number' ? params.maxTokens : null,
        });
        if (captureContent) {
            outputMessagesJson = helpers_1.default.buildOutputMessages(result.text || '', finishReason, normalizedToolCalls);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
            inputMessagesJson = helpers_1.default.buildInputMessages(messages, params.system);
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
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: modelId,
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: responseModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: VercelAIWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: VercelAIWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason],
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: outputType,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
                ...versionExtras,
            };
            if (responseId) {
                eventAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_ID] = responseId;
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
            model: modelId,
            cost,
            aiSystem: VercelAIWrapper.aiSystem,
            serverAddress: VercelAIWrapper.serverAddress,
            serverPort: VercelAIWrapper.serverPort,
        };
    }
}
VercelAIWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_VERCEL_AI;
VercelAIWrapper.serverAddress = 'vercel.ai';
VercelAIWrapper.serverPort = 443;
exports.default = VercelAIWrapper;
//# sourceMappingURL=wrapper.js.map