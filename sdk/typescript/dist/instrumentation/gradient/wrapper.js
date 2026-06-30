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
const utils_1 = require("./utils");
const AI_SYSTEM = semantic_convention_1.default.GEN_AI_SYSTEM_DIGITALOCEAN;
class GradientWrapper extends base_wrapper_1.default {
    static _patchChatCompletionCreate(tracer) {
        return GradientWrapper._buildChatPatch(tracer, {
            operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
            endpointKind: 'inference',
            genAIEndpoint: 'digitalocean.chat.completions',
            apiType: 'chat',
        });
    }
    static _patchAgentChatCompletionCreate(tracer) {
        return GradientWrapper._buildChatPatch(tracer, {
            operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
            endpointKind: 'agent',
            genAIEndpoint: 'digitalocean.agents.chat.completions',
            apiType: 'chat',
            isAgent: true,
        });
    }
    static _buildChatPatch(tracer, options) {
        const { operationName, endpointKind, genAIEndpoint, apiType, isAgent = false } = options;
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const body = args[0] || {};
                const requestModel = body.model || 'unknown';
                const [serverAddress, serverPort] = (0, utils_1.resolveGradientEndpoint)(this, endpointKind);
                const spanName = `${operationName} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: (0, utils_1.gradientSpanCreationAttrs)(operationName, requestModel, serverAddress, serverPort),
                }, effectiveCtx);
                if (isAgent) {
                    const agentId = (0, utils_1.agentIdFromHost)(serverAddress);
                    if (agentId) {
                        span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_ID, agentId);
                    }
                }
                return api_1.context
                    .with(api_1.trace.setSpan(effectiveCtx, span), async () => originalMethod.apply(this, args))
                    .then((response) => {
                    if (body.stream) {
                        return helpers_1.default.createStreamProxy(response, GradientWrapper._chatCompletionGenerator({
                            args,
                            genAIEndpoint,
                            response,
                            span,
                            serverAddress,
                            serverPort,
                            operationName,
                            apiType,
                        }));
                    }
                    return GradientWrapper._chatCompletion({
                        args,
                        genAIEndpoint,
                        response,
                        span,
                        serverAddress,
                        serverPort,
                        operationName,
                        apiType,
                    });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: AI_SYSTEM,
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
    static _patchImageGenerate(tracer) {
        const genAIEndpoint = 'digitalocean.images.generate';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const body = args[0] || {};
                const requestModel = body.model || 'unknown';
                const [serverAddress, serverPort] = (0, utils_1.resolveGradientEndpoint)(this, 'inference');
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: (0, utils_1.gradientSpanCreationAttrs)(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT, requestModel, serverAddress, serverPort),
                }, effectiveCtx);
                return api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    let metricParams;
                    try {
                        const response = await originalMethod.apply(this, args);
                        metricParams = GradientWrapper._imageGenerateCommonSetter({
                            args,
                            genAIEndpoint,
                            response,
                            span,
                            serverAddress,
                            serverPort,
                        });
                        return response;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint,
                            model: requestModel,
                            aiSystem: AI_SYSTEM,
                            serverAddress,
                            serverPort,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
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
    static async _chatCompletion({ args, genAIEndpoint, response, span, serverAddress, serverPort, operationName, apiType, }) {
        let metricParams;
        try {
            metricParams = await GradientWrapper._chatCompletionCommonSetter({
                args,
                genAIEndpoint,
                result: response,
                span,
                serverAddress,
                serverPort,
                operationName,
                apiType,
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
    static async *_chatCompletionGenerator({ args, genAIEndpoint, response, span, serverAddress, serverPort, operationName, apiType, }) {
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
                choices: [
                    {
                        index: 0,
                        logprobs: null,
                        finish_reason: 'stop',
                        message: { role: 'assistant', content: '', reasoning_content: '' },
                    },
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                    output_tokens_details: { reasoning_tokens: 0 },
                },
            };
            const toolCalls = [];
            let reasoningText = '';
            for await (const chunk of response) {
                timestamps.push(Date.now());
                if (chunk.id)
                    result.id = chunk.id;
                if (chunk.created)
                    result.created = chunk.created;
                if (chunk.model)
                    result.model = chunk.model;
                if (chunk.system_fingerprint)
                    result.system_fingerprint = chunk.system_fingerprint;
                if (chunk.choices?.[0]?.finish_reason) {
                    result.choices[0].finish_reason = chunk.choices[0].finish_reason;
                }
                if (chunk.choices?.[0]?.logprobs) {
                    result.choices[0].logprobs = chunk.choices[0].logprobs;
                }
                if (chunk.choices?.[0]?.delta?.content) {
                    result.choices[0].message.content += chunk.choices[0].delta.content;
                }
                if (chunk.choices?.[0]?.delta?.reasoning_content) {
                    reasoningText += chunk.choices[0].delta.reasoning_content;
                    result.choices[0].message.reasoning_content = reasoningText;
                }
                if (chunk.choices?.[0]?.delta?.tool_calls) {
                    const deltaTools = chunk.choices[0].delta.tool_calls;
                    for (const tool of deltaTools) {
                        const idx = tool.index || 0;
                        while (toolCalls.length <= idx) {
                            toolCalls.push({
                                id: '',
                                type: 'function',
                                function: { name: '', arguments: '' },
                            });
                        }
                        if (tool.id) {
                            toolCalls[idx].id = tool.id;
                            toolCalls[idx].type = tool.type || 'function';
                            if (tool.function?.name)
                                toolCalls[idx].function.name = tool.function.name;
                            if (tool.function?.arguments)
                                toolCalls[idx].function.arguments = tool.function.arguments;
                        }
                        else if (tool.function?.arguments) {
                            toolCalls[idx].function.arguments += tool.function.arguments;
                        }
                    }
                    tools = true;
                }
                if (chunk.usage) {
                    result.usage.prompt_tokens = chunk.usage.prompt_tokens || 0;
                    result.usage.completion_tokens = chunk.usage.completion_tokens || 0;
                    result.usage.total_tokens = chunk.usage.total_tokens || 0;
                    const details = chunk.usage.output_tokens_details || chunk.usage.completion_tokens_details;
                    if (details?.reasoning_tokens) {
                        result.usage.output_tokens_details.reasoning_tokens = details.reasoning_tokens;
                    }
                }
                yield chunk;
            }
            if (toolCalls.length > 0) {
                result.choices[0].message = {
                    ...result.choices[0].message,
                    tool_calls: toolCalls,
                };
            }
            if (!result.usage.prompt_tokens && !result.usage.completion_tokens) {
                let promptTokens = 0;
                for (const message of messages || []) {
                    promptTokens += helpers_1.default.openaiTokens(message.content, result.model) ?? 0;
                }
                const completionTokens = helpers_1.default.openaiTokens(result.choices[0].message.content ?? '', result.model);
                if (completionTokens) {
                    result.usage = {
                        ...result.usage,
                        prompt_tokens: promptTokens,
                        completion_tokens: completionTokens,
                        total_tokens: promptTokens + completionTokens,
                    };
                }
            }
            args[0].tools = tools;
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
            }
            metricParams = await GradientWrapper._chatCompletionCommonSetter({
                args,
                genAIEndpoint,
                result,
                span,
                ttft,
                tbt,
                serverAddress,
                serverPort,
                operationName,
                apiType,
                reasoningText,
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
    static _imageGenerateCommonSetter({ args, genAIEndpoint, response, span, serverAddress, serverPort, }) {
        const captureContent = config_1.default.captureMessageContent;
        const body = args[0] || {};
        const requestModel = body.model || 'unknown';
        const responseModel = response?.model || requestModel;
        const size = body.size || response?.size || '1024x1024';
        const quality = body.quality || response?.quality || 'standard';
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = helpers_1.default.getImageModelCost(requestModel, pricingInfo, size, quality);
        GradientWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user: body.user,
            cost,
            aiSystem: AI_SYSTEM,
            serverAddress,
            serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, 'image');
        if (response?.created != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, String(response.created));
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        if (captureContent && body.prompt) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, JSON.stringify([
                {
                    role: 'user',
                    parts: [{ type: 'text', content: String(body.prompt) }],
                },
            ]));
        }
        return {
            genAIEndpoint,
            model: requestModel,
            user: body.user,
            cost,
            aiSystem: AI_SYSTEM,
            serverAddress,
            serverPort,
        };
    }
    static async _chatCompletionCommonSetter({ args, genAIEndpoint, result, span, ttft = 0, tbt = 0, serverAddress, serverPort, operationName = semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT, apiType = 'chat', reasoningText, }) {
        const captureContent = config_1.default.captureMessageContent;
        const body = args[0] || {};
        const requestModel = body.model || 'unknown';
        const { messages, tools: _tools, stream: _stream = false } = body;
        (0, utils_1.applyGradientChatRequestAttributes)(span, body);
        span.setAttribute(semantic_convention_1.default.OPENAI_API_TYPE, apiType);
        if (captureContent) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages(messages || []));
        }
        if (result.id) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, result.id);
        }
        const responseModel = result.model || requestModel;
        const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, usage.prompt_tokens, usage.completion_tokens);
        GradientWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user: body.user,
            cost,
            aiSystem: AI_SYSTEM,
            serverAddress,
            serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        if (result.system_fingerprint) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_SYSTEM_FINGERPRINT, result.system_fingerprint);
        }
        const inputTokens = usage.prompt_tokens || 0;
        const outputTokens = usage.completion_tokens || 0;
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE, inputTokens + outputTokens);
        const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ??
            usage.completion_tokens_details?.reasoning_tokens ??
            0;
        if (reasoningTokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_REASONING_TOKENS, reasoningTokens);
        }
        if (ttft > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        }
        if (tbt > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        }
        if (result.choices?.[0]?.finish_reason) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [
                result.choices[0].finish_reason,
            ]);
        }
        const outputType = body.response_format?.type === 'json_object'
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT;
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
        const message = result.choices?.[0]?.message || {};
        const resolvedReasoning = reasoningText ||
            message.reasoning_content ||
            '';
        if (message.tool_calls) {
            const toolCalls = message.tool_calls;
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
        const systemInstructionsJson = helpers_1.default.buildSystemInstructionsFromMessages(messages || []);
        const versionExtras = {};
        try {
            const maxTokens = body.max_completion_tokens ?? body.max_tokens ?? null;
            const versionHash = helpers_1.default.computeAgentVersionHash({
                systemInstructions: systemInstructionsJson ?? null,
                toolDefinitions: toolDefinitionsJson ?? null,
                primaryModel: responseModel || requestModel,
                runtimeConfig: {
                    temperature: body.temperature ?? null,
                    top_p: body.top_p ?? null,
                    max_tokens: maxTokens,
                    provider: AI_SYSTEM,
                },
                providers: [AI_SYSTEM],
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
            const toolCalls = message.tool_calls;
            outputMessagesJson = GradientWrapper._buildOutputMessages(message.content || '', result.choices?.[0]?.finish_reason || 'stop', toolCalls, resolvedReasoning || undefined);
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
                [semantic_convention_1.default.GEN_AI_OPERATION]: operationName,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: responseModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: result.id,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [result.choices?.[0]?.finish_reason],
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: outputType,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
                ...versionExtras,
            };
            if (captureContent) {
                if (inputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
                if (systemInstructionsJson) {
                    eventAttrs[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS] = systemInstructionsJson;
                }
                if (outputMessagesJson) {
                    eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
                }
            }
            if (toolDefinitionsJson) {
                eventAttrs[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS] = toolDefinitionsJson;
            }
            helpers_1.default.emitInferenceEvent(span, eventAttrs);
        }
        return {
            genAIEndpoint,
            model: requestModel,
            user: body.user,
            cost,
            aiSystem: AI_SYSTEM,
            serverAddress,
            serverPort,
        };
    }
    static _buildOutputMessages(text, finishReason, toolCalls, reasoning) {
        try {
            const parts = [];
            if (reasoning) {
                parts.push({ type: 'reasoning', content: reasoning });
            }
            if (text) {
                parts.push({ type: 'text', content: text });
            }
            if (toolCalls?.length) {
                for (const tc of toolCalls) {
                    let argsVal = tc.function?.arguments || tc.arguments || {};
                    if (typeof argsVal === 'string') {
                        try {
                            argsVal = JSON.parse(argsVal);
                        }
                        catch {
                            argsVal = { raw: argsVal };
                        }
                    }
                    parts.push({
                        type: 'tool_call',
                        id: tc.id || '',
                        name: tc.function?.name || tc.name || '',
                        arguments: argsVal,
                    });
                }
            }
            return JSON.stringify([
                { role: 'assistant', parts, finish_reason: finishReason || 'stop' },
            ]);
        }
        catch {
            return '[]';
        }
    }
}
GradientWrapper.aiSystem = AI_SYSTEM;
exports.default = GradientWrapper;
//# sourceMappingURL=wrapper.js.map