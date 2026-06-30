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
const FINISH_REASON_MAP = {
    end_turn: 'stop',
    max_tokens: 'length',
    stop_sequence: 'stop',
    tool_use: 'tool_call',
};
function mapFinishReason(reason) {
    return FINISH_REASON_MAP[reason] || reason || 'stop';
}
function spanCreationAttrs(operationName, requestModel) {
    return {
        [semantic_convention_1.default.GEN_AI_OPERATION]: operationName,
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: AnthropicWrapper.aiSystem,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: AnthropicWrapper.serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: AnthropicWrapper.serverPort,
    };
}
class AnthropicWrapper extends base_wrapper_1.default {
    static _patchMessageCreate(tracer) {
        const genAIEndpoint = 'anthropic.resources.messages';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const requestModel = args[0]?.model || 'claude-3-5-sonnet-latest';
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
                        return helpers_1.default.createStreamProxy(response, AnthropicWrapper._messageCreateGenerator({
                            args,
                            genAIEndpoint,
                            response,
                            span,
                        }));
                    }
                    return AnthropicWrapper._messageCreate({ args, genAIEndpoint, response, span });
                })
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: AnthropicWrapper.aiSystem,
                        serverAddress: AnthropicWrapper.serverAddress,
                        serverPort: AnthropicWrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static async _messageCreate({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        try {
            metricParams = await AnthropicWrapper._messageCreateCommonSetter({
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
    static async *_messageCreateGenerator({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        const timestamps = [];
        const startTime = Date.now();
        try {
            const result = {
                id: '',
                model: '',
                stop_reason: '',
                content: [],
                usage: {
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
            };
            let llmResponse = '';
            let toolId = '';
            let toolName = '';
            let toolArguments = '';
            for await (const chunk of response) {
                timestamps.push(Date.now());
                switch (chunk.type) {
                    case 'message_start':
                        if (chunk.message) {
                            result.id = chunk.message.id;
                            result.model = chunk.message.model;
                            result.usage.input_tokens = Number(chunk.message.usage?.input_tokens) || 0;
                            result.usage.output_tokens += Number(chunk.message.usage?.output_tokens) || 0;
                            result.usage.cache_creation_input_tokens =
                                Number(chunk.message.usage?.cache_creation_input_tokens) || 0;
                            result.usage.cache_read_input_tokens =
                                Number(chunk.message.usage?.cache_read_input_tokens) || 0;
                            result.stop_reason = chunk.message.stop_reason || '';
                        }
                        break;
                    case 'content_block_start':
                        if (chunk.content_block?.type === 'tool_use') {
                            toolId = chunk.content_block.id || '';
                            toolName = chunk.content_block.name || '';
                            toolArguments = '';
                        }
                        break;
                    case 'content_block_delta':
                        if (chunk.delta?.text) {
                            llmResponse += chunk.delta.text;
                        }
                        if (chunk.delta?.partial_json) {
                            toolArguments += chunk.delta.partial_json;
                        }
                        break;
                    case 'content_block_stop':
                        break;
                    case 'message_delta':
                        result.stop_reason = chunk.delta?.stop_reason || result.stop_reason;
                        result.usage.output_tokens += Number(chunk.usage?.output_tokens) || 0;
                        if (chunk.usage?.cache_creation_input_tokens != null) {
                            result.usage.cache_creation_input_tokens =
                                Number(chunk.usage.cache_creation_input_tokens) || 0;
                        }
                        if (chunk.usage?.cache_read_input_tokens != null) {
                            result.usage.cache_read_input_tokens =
                                Number(chunk.usage.cache_read_input_tokens) || 0;
                        }
                        break;
                    case 'message_stop':
                        break;
                }
                yield chunk;
            }
            if (llmResponse) {
                result.content.push({ type: 'text', text: llmResponse });
            }
            if (toolId) {
                let parsedInput = {};
                try {
                    parsedInput = JSON.parse(toolArguments);
                }
                catch { /* keep empty */ }
                result.content.push({
                    type: 'tool_use',
                    id: toolId,
                    name: toolName,
                    input: parsedInput,
                });
            }
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
            }
            metricParams = await AnthropicWrapper._messageCreateCommonSetter({
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
    static async _messageCreateCommonSetter({ args, genAIEndpoint, result, span, ttft = 0, tbt = 0, }) {
        const captureContent = config_1.default.captureMessageContent;
        const requestModel = args[0]?.model || 'claude-3-5-sonnet-latest';
        const { messages, system, max_tokens = null, seed = null, temperature = 1, top_p, top_k, stop_sequences = null, stream = false, user, tools: _tools, } = args[0];
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, temperature);
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, top_p || 1);
        if (top_k != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_K, top_k);
        }
        if (max_tokens != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, stream);
        if (seed != null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_SEED, Number(seed));
        }
        if (stop_sequences && Array.isArray(stop_sequences) && stop_sequences.length > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, stop_sequences);
        }
        if (captureContent) {
            const systemStr = typeof system === 'string' ? system : undefined;
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages(messages || [], systemStr));
            if (system) {
                const sysAttr = typeof system === 'string' ? system : JSON.stringify(system);
                span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, sysAttr);
            }
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, result.id);
        const responseModel = result.model || requestModel;
        const pricingInfo = config_1.default.pricingInfo || {};
        // Anthropic reports input_tokens exclusive of cache read / creation tokens,
        // so cache tokens are added on top (promptTokensIncludeCache stays false).
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, result.usage.input_tokens, result.usage.output_tokens, Number(result.usage.cache_read_input_tokens) || 0, Number(result.usage.cache_creation_input_tokens) || 0);
        AnthropicWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            user,
            cost,
            aiSystem: AnthropicWrapper.aiSystem,
            serverAddress: AnthropicWrapper.serverAddress,
            serverPort: AnthropicWrapper.serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        const inputTokens = result.usage.input_tokens;
        const outputTokens = result.usage.output_tokens;
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        if (result.usage.cache_creation_input_tokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, result.usage.cache_creation_input_tokens);
        }
        if (result.usage.cache_read_input_tokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, result.usage.cache_read_input_tokens);
        }
        if (ttft > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        }
        if (tbt > 0) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        }
        const finishReason = mapFinishReason(result.stop_reason);
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
        const toolUseBlocks = (result.content || []).filter((b) => b.type === 'tool_use');
        const outputType = toolUseBlocks.length > 0
            ? semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON
            : semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT;
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
        if (toolUseBlocks.length > 0) {
            const toolNames = toolUseBlocks.map((b) => b.name || '').filter(Boolean);
            const toolIds = toolUseBlocks.map((b) => b.id || '').filter(Boolean);
            const toolArgs = toolUseBlocks.map((b) => JSON.stringify(b.input || {}));
            if (toolNames.length > 0)
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, toolNames.join(', '));
            if (toolIds.length > 0)
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, toolIds.join(', '));
            if (toolArgs.length > 0)
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_ARGS, toolArgs.join(', '));
        }
        let inputMessagesJson;
        let outputMessagesJson;
        // Anthropic tool schema uses `input_schema` instead of `parameters`; the
        // shared helper already handles both shapes.
        const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(_tools);
        const systemInstructionsJson = (() => {
            if (!system)
                return undefined;
            if (typeof system === 'string') {
                return JSON.stringify([{ type: 'text', content: system }]);
            }
            try {
                return JSON.stringify(system);
            }
            catch {
                return undefined;
            }
        })();
        // Stamp `openlit.agent.version_hash` (auto) and `gen_ai.agent.version`
        // (user override) regardless of content capture so versions still group
        // correctly when capture_message_content=false.
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
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_ANTHROPIC,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_ANTHROPIC],
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
            const textContent = (result.content || [])
                .filter((b) => b.type === 'text')
                .map((b) => b.text || '')
                .join('');
            const toolCallsForOutput = toolUseBlocks.length > 0
                ? toolUseBlocks.map((b) => ({
                    id: b.id || '',
                    name: b.name || '',
                    arguments: b.input || {},
                }))
                : undefined;
            outputMessagesJson = helpers_1.default.buildOutputMessages(textContent, finishReason, toolCallsForOutput);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
            const systemStr = typeof system === 'string' ? system : undefined;
            inputMessagesJson = helpers_1.default.buildInputMessages(messages || [], systemStr);
        }
        if (toolDefinitionsJson) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
        }
        if (!config_1.default.disableEvents) {
            const eventAttrs = {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: responseModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: AnthropicWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: AnthropicWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: result.id,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason],
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
            if (toolDefinitionsJson)
                eventAttrs[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS] = toolDefinitionsJson;
            helpers_1.default.emitInferenceEvent(span, eventAttrs);
        }
        return {
            genAIEndpoint,
            model: requestModel,
            user,
            cost,
            aiSystem: AnthropicWrapper.aiSystem,
        };
    }
}
AnthropicWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_ANTHROPIC;
AnthropicWrapper.serverAddress = 'api.anthropic.com';
AnthropicWrapper.serverPort = 443;
exports.default = AnthropicWrapper;
//# sourceMappingURL=wrapper.js.map