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
function mapFinishReason(stopReason) {
    const map = {
        end_turn: 'stop',
        max_tokens: 'max_tokens',
        stop_sequence: 'stop',
        tool_use: 'tool_calls',
        content_filtered: 'content_filter',
        guardrail_intervention: 'content_filter',
    };
    return map[stopReason] || stopReason;
}
function spanCreationAttrs(operationName, requestModel) {
    return {
        [semantic_convention_1.default.GEN_AI_OPERATION]: operationName,
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_AWS_BEDROCK,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: BedrockWrapper.serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: BedrockWrapper.serverPort,
    };
}
/**
 * Convert Bedrock message content blocks ({text: "..."}) to the format
 * expected by OpenLitHelper.buildInputMessages ({type: "text", text: "..."}).
 */
function convertBedrockMessages(messages) {
    return (messages || []).map((m) => {
        const role = m.role || 'user';
        const content = m.content;
        if (!Array.isArray(content)) {
            return { role, content: typeof content === 'string' ? content : '' };
        }
        return {
            role,
            content: content.map((c) => {
                if (c.text !== undefined)
                    return { type: 'text', text: c.text };
                if (c.toolUse) {
                    return {
                        type: 'tool_use',
                        id: c.toolUse.toolUseId || '',
                        name: c.toolUse.name || '',
                        input: c.toolUse.input || {},
                    };
                }
                if (c.toolResult) {
                    const rc = c.toolResult.content;
                    return {
                        type: 'tool_result',
                        tool_use_id: c.toolResult.toolUseId || '',
                        content: typeof rc === 'string' ? rc : JSON.stringify(rc || ''),
                    };
                }
                return c;
            }),
        };
    });
}
class BedrockWrapper extends base_wrapper_1.default {
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
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_AWS_BEDROCK,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_AWS_BEDROCK],
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
    static _patchSend(tracer) {
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const command = args[0];
                if (!command)
                    return originalMethod.apply(this, args);
                const commandName = command.constructor?.name || '';
                if (commandName === 'ConverseCommand') {
                    return BedrockWrapper._handleConverseCommand(tracer, originalMethod, this, args);
                }
                if (commandName === 'ConverseStreamCommand') {
                    return BedrockWrapper._handleConverseStreamCommand(tracer, originalMethod, this, args);
                }
                return originalMethod.apply(this, args);
            };
        };
    }
    static async _handleConverseCommand(tracer, originalMethod, instance, args) {
        const command = args[0];
        const input = command.input || {};
        const modelId = input.modelId || 'amazon.titan-text-express-v1';
        const genAIEndpoint = 'bedrock.converse';
        const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT} ${modelId}`;
        const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
        const span = tracer.startSpan(spanName, {
            kind: api_1.SpanKind.CLIENT,
            attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT, modelId),
        }, effectiveCtx);
        return api_1.context
            .with(api_1.trace.setSpan(effectiveCtx, span), async () => {
            return originalMethod.apply(instance, args);
        })
            .then((response) => {
            return BedrockWrapper._converseComplete({ input, genAIEndpoint, response, span, modelId });
        })
            .catch((e) => {
            helpers_1.default.handleException(span, e);
            base_wrapper_1.default.recordMetrics(span, {
                genAIEndpoint,
                model: modelId,
                aiSystem: BedrockWrapper.aiSystem,
                serverAddress: BedrockWrapper.serverAddress,
                serverPort: BedrockWrapper.serverPort,
                errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
        });
    }
    static async _converseComplete({ input, genAIEndpoint, response, span, modelId, }) {
        let metricParams;
        try {
            metricParams = BedrockWrapper._converseCommonSetter({
                input,
                genAIEndpoint,
                result: response,
                span,
                modelId,
                isStream: false,
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
    static async _handleConverseStreamCommand(tracer, originalMethod, instance, args) {
        const command = args[0];
        const input = command.input || {};
        const modelId = input.modelId || 'amazon.titan-text-express-v1';
        const genAIEndpoint = 'bedrock.converse_stream';
        const startTime = Date.now();
        const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT} ${modelId}`;
        const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
        const span = tracer.startSpan(spanName, {
            kind: api_1.SpanKind.CLIENT,
            attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT, modelId),
        }, effectiveCtx);
        let response;
        try {
            response = await api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), () => originalMethod.apply(instance, args));
        }
        catch (e) {
            helpers_1.default.handleException(span, e);
            base_wrapper_1.default.recordMetrics(span, {
                genAIEndpoint,
                model: modelId,
                aiSystem: BedrockWrapper.aiSystem,
                serverAddress: BedrockWrapper.serverAddress,
                serverPort: BedrockWrapper.serverPort,
                errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
        }
        let llmResponse = '';
        let finishReason = 'stop';
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadTokens = 0;
        let cacheWriteTokens = 0;
        const timestamps = [];
        const originalStream = response.stream;
        async function* wrappedStream() {
            try {
                for await (const event of originalStream) {
                    timestamps.push(Date.now());
                    if (event.contentBlockDelta?.delta?.text)
                        llmResponse += event.contentBlockDelta.delta.text;
                    if (event.messageStop?.stopReason)
                        finishReason = mapFinishReason(event.messageStop.stopReason);
                    if (event.metadata?.usage) {
                        inputTokens = event.metadata.usage.inputTokens || 0;
                        outputTokens = event.metadata.usage.outputTokens || 0;
                        cacheReadTokens = event.metadata.usage.cacheReadInputTokens || 0;
                        cacheWriteTokens = event.metadata.usage.cacheWriteInputTokens || 0;
                    }
                    yield event;
                }
            }
            finally {
                try {
                    const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
                    let tbt = 0;
                    if (timestamps.length > 1) {
                        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
                    }
                    const result = {
                        output: { message: { content: [{ text: llmResponse }] } },
                        stopReason: finishReason,
                        usage: {
                            inputTokens,
                            outputTokens,
                            cacheReadInputTokens: cacheReadTokens,
                            cacheWriteInputTokens: cacheWriteTokens,
                        },
                        $metadata: response.$metadata,
                    };
                    const metricParams = BedrockWrapper._converseCommonSetter({
                        input,
                        genAIEndpoint,
                        result,
                        span,
                        modelId,
                        isStream: true,
                        ttft,
                        tbt,
                    });
                    base_wrapper_1.default.recordMetrics(span, metricParams);
                }
                catch { /* ignore telemetry errors in finally */ }
                finally {
                    span.end();
                }
            }
        }
        return { ...response, stream: wrappedStream() };
    }
    static _converseCommonSetter({ input, genAIEndpoint, result, span, modelId, isStream, ttft = 0, tbt = 0, }) {
        const captureContent = config_1.default.captureMessageContent;
        const inferenceConfig = input.inferenceConfig || {};
        if (inferenceConfig.temperature !== undefined) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, inferenceConfig.temperature);
        }
        if (inferenceConfig.topP !== undefined) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, inferenceConfig.topP);
        }
        if (inferenceConfig.topK !== undefined) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_K, inferenceConfig.topK);
        }
        if (inferenceConfig.maxTokens != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, inferenceConfig.maxTokens);
        }
        if (inferenceConfig.stopSequences) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, inferenceConfig.stopSequences);
        }
        if (inferenceConfig.frequencyPenalty) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, inferenceConfig.frequencyPenalty);
        }
        if (inferenceConfig.presencePenalty) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, inferenceConfig.presencePenalty);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, isStream);
        const usage = result.usage || {};
        const inputTokens = usage.inputTokens || 0;
        const outputTokens = usage.outputTokens || 0;
        const cacheReadTokens = usage.cacheReadInputTokens || 0;
        const cacheWriteTokens = usage.cacheWriteInputTokens || 0;
        const responseModel = modelId;
        const finishReason = mapFinishReason(result.stopReason || 'stop');
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = helpers_1.default.getChatModelCost(modelId, pricingInfo, inputTokens, outputTokens);
        BedrockWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: modelId,
            cost,
            aiSystem: BedrockWrapper.aiSystem,
            serverAddress: BedrockWrapper.serverAddress,
            serverPort: BedrockWrapper.serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        const requestId = result.$metadata?.requestId;
        if (requestId) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, requestId);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        if (cacheReadTokens > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheReadTokens);
        }
        if (cacheWriteTokens > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheWriteTokens);
        }
        if (ttft > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        }
        if (tbt > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
        const outputText = result.output?.message?.content?.map((c) => c.text || '').join('') || '';
        const outputType = typeof outputText === 'string'
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON;
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
        const contentBlocks = result.output?.message?.content || [];
        const toolCalls = contentBlocks
            .filter((c) => c.toolUse)
            .map((c) => ({
            id: c.toolUse.toolUseId || '',
            name: c.toolUse.name || '',
            arguments: c.toolUse.input || {},
        }));
        if (toolCalls.length > 0) {
            const toolNames = toolCalls.map((t) => t.name).filter(Boolean);
            const toolIds = toolCalls.map((t) => t.id).filter(Boolean);
            const toolArgs = toolCalls
                .map((t) => (typeof t.arguments === 'string' ? t.arguments : JSON.stringify(t.arguments)))
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
        const messages = convertBedrockMessages(input.messages || []);
        const systemBlock = input.system || [];
        const systemParts = [];
        if (Array.isArray(systemBlock)) {
            for (const item of systemBlock) {
                if (item?.text) {
                    systemParts.push({ type: 'text', content: item.text });
                }
            }
        }
        // Bedrock Converse API expresses tools as
        // `toolConfig.tools: [{ toolSpec: { name, description, inputSchema: { json } } }, ...]`.
        // Normalize to the flat shape understood by `buildToolDefinitions`.
        let bedrockToolDefs;
        const rawBedrockTools = input.toolConfig?.tools;
        if (Array.isArray(rawBedrockTools)) {
            bedrockToolDefs = rawBedrockTools
                .map((tool) => {
                const spec = tool?.toolSpec ?? tool;
                if (!spec || typeof spec !== 'object')
                    return null;
                return {
                    name: spec.name ?? '',
                    description: spec.description ?? '',
                    parameters: spec.inputSchema?.json ?? spec.inputSchema ?? spec.parameters ?? {},
                };
            })
                .filter((t) => t && t.name);
        }
        const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(bedrockToolDefs);
        let inputMessagesJson;
        let outputMessagesJson;
        // Compute system_instructions and version hash regardless of
        // captureContent so versions still group correctly when content
        // capture is disabled.
        const systemInstructionsJson = systemParts.length > 0 ? JSON.stringify(systemParts) : undefined;
        const versionExtras = BedrockWrapper._stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: responseModel || modelId,
            temperature: inferenceConfig.temperature ?? null,
            top_p: inferenceConfig.topP ?? null,
            max_tokens: inferenceConfig.maxTokens ?? null,
        });
        if (captureContent) {
            inputMessagesJson = helpers_1.default.buildInputMessages(messages);
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
            if (systemInstructionsJson) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstructionsJson);
            }
            outputMessagesJson = helpers_1.default.buildOutputMessages(outputText, finishReason, toolCalls.length > 0 ? toolCalls : undefined);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
        }
        if (toolDefinitionsJson) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
        }
        if (!config_1.default.disableEvents) {
            const eventAttrs = {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: modelId,
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: responseModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: BedrockWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: BedrockWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason],
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: outputType,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
                ...versionExtras,
            };
            if (requestId) {
                eventAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_ID] = requestId;
            }
            if (captureContent) {
                if (inputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
                if (outputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
                if (systemInstructionsJson) {
                    eventAttrs[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS] = systemInstructionsJson;
                }
            }
            if (toolDefinitionsJson)
                eventAttrs[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS] = toolDefinitionsJson;
            helpers_1.default.emitInferenceEvent(span, eventAttrs);
        }
        return {
            genAIEndpoint,
            model: modelId,
            cost,
            aiSystem: BedrockWrapper.aiSystem,
        };
    }
}
BedrockWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_AWS_BEDROCK;
BedrockWrapper.serverAddress = 'bedrock-runtime.amazonaws.com';
BedrockWrapper.serverPort = 443;
exports.default = BedrockWrapper;
//# sourceMappingURL=wrapper.js.map