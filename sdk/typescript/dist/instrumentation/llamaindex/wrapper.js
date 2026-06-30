"use strict";
/**
 * OpenLIT LlamaIndex Wrapper
 *
 * Mirrors Python SDK: sdk/python/src/openlit/instrumentation/llamaindex/
 * Uses the same OPERATION_MAP and span semantics as the Python implementation.
 *
 * LLM operations get full provider-style telemetry (attributes, events, metrics).
 * Framework operations (query engine, retriever, index, etc.) get framework-level spans.
 */
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
/**
 * Operation mapping matching Python SDK's OPERATION_MAP in
 * sdk/python/src/openlit/instrumentation/llamaindex/utils.py
 */
const OPERATION_MAP = {
    // Document Loading & Processing
    document_load: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_RETRIEVE,
    document_transform: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    document_split: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    // Index Construction & Management
    index_construct: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    index_insert: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    index_delete: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    index_build: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    // Query Engine Operations
    query_engine_create: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    query_engine_query: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_RETRIEVE,
    // Retriever Operations
    retriever_create: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    retriever_retrieve: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_RETRIEVE,
    // LLM Operations
    llm_chat: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
    llm_complete: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
    // Embedding Operations
    embedding_generate: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_EMBEDDING,
    // Response Synthesis
    response_synthesize: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
    // Text Processing Components
    text_splitter_split: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    node_parser_parse: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    // Vector Store Components
    vector_store_add: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    vector_store_delete: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    vector_store_query: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_RETRIEVE,
    // Postprocessor
    postprocessor_process: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
};
class LlamaIndexWrapper {
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
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_LLAMAINDEX,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_LLAMAINDEX],
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
    // ---------------------------------------------------------------------------
    // Helpers (mirrors Python set_server_address_and_port / model extraction)
    // ---------------------------------------------------------------------------
    static _extractModel(instance) {
        return instance?.model
            || instance?.modelName
            || instance?.metadata?.model
            || instance?.llm?.model
            || instance?._llm?.model
            || instance?._responseSynthesizer?.llm?.model
            || instance?._responseSynthesizer?._llm?.model
            || 'unknown';
    }
    static _extractServerInfo(instance) {
        const candidates = [
            instance?._client?.baseURL,
            instance?.session?.openai?.baseURL,
            instance?.clientOptions?.baseURL,
            instance?.llm?._client?.baseURL,
            instance?._llm?._client?.baseURL,
            instance?.llm?.session?.openai?.baseURL,
            instance?._llm?.session?.openai?.baseURL,
        ];
        for (const rawUrl of candidates) {
            if (rawUrl) {
                try {
                    const parsed = new URL(rawUrl);
                    return {
                        address: parsed.hostname,
                        port: parsed.port
                            ? parseInt(parsed.port, 10)
                            : (parsed.protocol === 'https:' ? 443 : 80),
                    };
                }
                catch { /* try next */ }
            }
        }
        return { address: 'localhost', port: 8000 };
    }
    // ---------------------------------------------------------------------------
    // LLM chat patch — full provider-style telemetry + frameworkLlmActive
    // Mirrors Python: LLM.chat -> operation_type "chat"
    // ---------------------------------------------------------------------------
    static _patchLLMChat(tracer) {
        const endpoint = 'llm_chat';
        const operationType = OPERATION_MAP[endpoint];
        return (originalMethod) => {
            return function (...args) {
                const requestModel = LlamaIndexWrapper._extractModel(this);
                const { address, port } = LlamaIndexWrapper._extractServerInfo(this);
                const spanName = `${operationType} ${requestModel}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
                        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                        [semantic_convention_1.default.SERVER_ADDRESS]: address,
                        [semantic_convention_1.default.SERVER_PORT]: port,
                    },
                });
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    const startTime = Date.now();
                    const onSuccess = (response) => {
                        try {
                            LlamaIndexWrapper._processLLMResponse(span, response, requestModel, address, port, startTime, args, 'chat');
                        }
                        catch { /* swallow telemetry errors */ }
                        return response;
                    };
                    const onError = (e) => {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint: endpoint,
                            model: requestModel,
                            aiSystem: LlamaIndexWrapper.aiSystem,
                            serverAddress: address,
                            serverPort: port,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
                        span.end();
                        throw e;
                    };
                    try {
                        const result = (0, helpers_1.runWithFrameworkLlm)(() => originalMethod.apply(this, args));
                        if (result && typeof result.then === 'function') {
                            return result.then(onSuccess).catch(onError);
                        }
                        return onSuccess(result);
                    }
                    catch (e) {
                        return onError(e);
                    }
                });
            };
        };
    }
    // ---------------------------------------------------------------------------
    // LLM complete patch — full provider-style telemetry + frameworkLlmActive
    // Mirrors Python: LLM.complete -> operation_type "chat"
    // ---------------------------------------------------------------------------
    static _patchLLMComplete(tracer) {
        const endpoint = 'llm_complete';
        const operationType = OPERATION_MAP[endpoint];
        return (originalMethod) => {
            return function (...args) {
                const requestModel = LlamaIndexWrapper._extractModel(this);
                const { address, port } = LlamaIndexWrapper._extractServerInfo(this);
                const spanName = `${operationType} ${requestModel}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
                        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                        [semantic_convention_1.default.SERVER_ADDRESS]: address,
                        [semantic_convention_1.default.SERVER_PORT]: port,
                    },
                });
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    const startTime = Date.now();
                    const onSuccess = (response) => {
                        try {
                            LlamaIndexWrapper._processLLMResponse(span, response, requestModel, address, port, startTime, args, 'complete');
                        }
                        catch { /* swallow */ }
                        return response;
                    };
                    const onError = (e) => {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint: endpoint,
                            model: requestModel,
                            aiSystem: LlamaIndexWrapper.aiSystem,
                            serverAddress: address,
                            serverPort: port,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
                        span.end();
                        throw e;
                    };
                    try {
                        const result = (0, helpers_1.runWithFrameworkLlm)(() => originalMethod.apply(this, args));
                        if (result && typeof result.then === 'function') {
                            return result.then(onSuccess).catch(onError);
                        }
                        return onSuccess(result);
                    }
                    catch (e) {
                        return onError(e);
                    }
                });
            };
        };
    }
    // ---------------------------------------------------------------------------
    // Shared LLM response processor — attributes, events, metrics
    // ---------------------------------------------------------------------------
    static _processLLMResponse(span, response, requestModel, serverAddress, serverPort, startTime, args, mode) {
        const endpoint = mode === 'chat' ? 'llm_chat' : 'llm_complete';
        const duration = (Date.now() - startTime) / 1000;
        const rawUsage = response?.raw?.usage || response?.usage || {};
        const inputTokens = rawUsage.prompt_tokens || rawUsage.input_tokens || 0;
        const outputTokens = rawUsage.completion_tokens || rawUsage.output_tokens || 0;
        const finishReason = response?.raw?.choices?.[0]?.finish_reason || 'stop';
        const responseModel = response?.raw?.model || requestModel;
        const responseId = response?.raw?.id || '';
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);
        base_wrapper_1.default.setBaseSpanAttributes(span, {
            genAIEndpoint: endpoint,
            model: requestModel,
            cost,
            aiSystem: LlamaIndexWrapper.aiSystem,
            serverAddress,
            serverPort,
        });
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
        if (responseModel) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
        }
        if (responseId) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, responseId);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
        if (inputTokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        }
        if (outputTokens) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
        let inputMessagesJson = '';
        let outputMessagesJson = '';
        const requestTools = (mode === 'chat' && args[0] && !Array.isArray(args[0]) ? args[0]?.tools : undefined) ||
            (args[0] && typeof args[0] === 'object' ? args[0].tools : undefined);
        const toolDefinitionsJson = helpers_1.default.buildToolDefinitions(requestTools);
        // Compute system_instructions JSON regardless of captureContent so the
        // version hash still groups correctly when content capture is disabled.
        let systemInstructionsJson;
        if (mode === 'chat') {
            const messages = args[0]?.messages || (Array.isArray(args[0]) ? args[0] : []);
            const formatted = (Array.isArray(messages) ? messages : [messages]).map((m) => ({
                role: m.role || 'user',
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
            }));
            systemInstructionsJson = helpers_1.default.buildSystemInstructionsFromMessages(formatted);
        }
        const versionExtras = LlamaIndexWrapper._stampAgentVersion(span, {
            systemInstructionsJson,
            toolDefinitionsJson,
            primaryModel: responseModel || requestModel,
            temperature: null,
            top_p: null,
            max_tokens: null,
        });
        if (config_1.default.captureMessageContent) {
            if (mode === 'chat') {
                const messages = args[0]?.messages || (Array.isArray(args[0]) ? args[0] : []);
                const formatted = (Array.isArray(messages) ? messages : [messages]).map((m) => ({
                    role: m.role || 'user',
                    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
                }));
                inputMessagesJson = helpers_1.default.buildInputMessages(formatted);
                const text = response?.message?.content || response?.text || '';
                outputMessagesJson = helpers_1.default.buildOutputMessages(text, finishReason);
            }
            else {
                const prompt = typeof args[0] === 'string' ? args[0] : args[0]?.prompt || '';
                inputMessagesJson = helpers_1.default.buildInputMessages([{ role: 'user', content: prompt }]);
                const text = response?.text || '';
                outputMessagesJson = helpers_1.default.buildOutputMessages(text, finishReason);
            }
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
            if (systemInstructionsJson) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstructionsJson);
            }
        }
        if (toolDefinitionsJson) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
        }
        const eventAttrs = {
            [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
            [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
            [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: responseModel,
            [semantic_convention_1.default.SERVER_ADDRESS]: serverAddress,
            [semantic_convention_1.default.SERVER_PORT]: serverPort,
            [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: responseId,
            [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason],
            [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT,
            [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
            [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
            ...versionExtras,
        };
        if (config_1.default.captureMessageContent) {
            eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
            eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
            if (systemInstructionsJson)
                eventAttrs[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS] = systemInstructionsJson;
        }
        if (toolDefinitionsJson)
            eventAttrs[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS] = toolDefinitionsJson;
        helpers_1.default.emitInferenceEvent(span, eventAttrs);
        base_wrapper_1.default.recordMetrics(span, {
            genAIEndpoint: endpoint,
            model: requestModel,
            cost,
            aiSystem: LlamaIndexWrapper.aiSystem,
            serverAddress,
            serverPort,
        });
        span.end();
    }
    // ---------------------------------------------------------------------------
    // Query engine query patch — retrieval span with source nodes
    // Mirrors Python: RetrieverQueryEngine.query -> operation_type "retrieval"
    // ---------------------------------------------------------------------------
    static _patchQueryEngineQuery(tracer) {
        const endpoint = 'query_engine_query';
        const operationType = OPERATION_MAP[endpoint];
        return (originalMethod) => {
            return function (...args) {
                const requestModel = LlamaIndexWrapper._extractModel(this);
                const { address, port } = LlamaIndexWrapper._extractServerInfo(this?.llm || this?._llm || this);
                const spanName = `${operationType} ${endpoint}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
                    },
                });
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    const startTime = Date.now();
                    const onSuccess = (response) => {
                        try {
                            const duration = (Date.now() - startTime) / 1000;
                            base_wrapper_1.default.setBaseSpanAttributes(span, {
                                genAIEndpoint: endpoint,
                                model: requestModel,
                                aiSystem: LlamaIndexWrapper.aiSystem,
                                serverAddress: address,
                                serverPort: port,
                            });
                            span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
                            const sourceNodes = response?.sourceNodes || response?.source_nodes || [];
                            if (sourceNodes.length > 0) {
                                span.setAttribute(semantic_convention_1.default.GEN_AI_RETRIEVAL_SOURCE, JSON.stringify(sourceNodes.slice(0, 5).map((n) => ({
                                    id: n.node?.id_ || n.id_ || '',
                                    score: n.score,
                                    text: n.node?.text?.slice(0, 200) || '',
                                }))));
                            }
                            if (config_1.default.captureMessageContent) {
                                const queryStr = typeof args[0] === 'string'
                                    ? args[0]
                                    : args[0]?.query || args[0]?.queryStr || '';
                                span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages([{ role: 'user', content: queryStr }]));
                                const responseText = typeof response?.response === 'string'
                                    ? response.response
                                    : response?.message?.content || response?.toString?.() || '';
                                span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, helpers_1.default.buildOutputMessages(responseText, 'stop'));
                            }
                            base_wrapper_1.default.recordMetrics(span, {
                                genAIEndpoint: endpoint,
                                model: requestModel,
                                aiSystem: LlamaIndexWrapper.aiSystem,
                                serverAddress: address,
                                serverPort: port,
                            });
                        }
                        catch { /* swallow */ }
                        span.end();
                        return response;
                    };
                    const onError = (e) => {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint: endpoint,
                            model: requestModel,
                            aiSystem: LlamaIndexWrapper.aiSystem,
                            serverAddress: address,
                            serverPort: port,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
                        span.end();
                        throw e;
                    };
                    try {
                        const result = originalMethod.apply(this, args);
                        if (result && typeof result.then === 'function') {
                            return result.then(onSuccess).catch(onError);
                        }
                        return onSuccess(result);
                    }
                    catch (e) {
                        return onError(e);
                    }
                });
            };
        };
    }
    // ---------------------------------------------------------------------------
    // Chat engine chat patch — framework span with chat content
    // Mirrors Python: chat engine operations -> operation_type "invoke_workflow"
    // ---------------------------------------------------------------------------
    static _patchChatEngineChat(tracer) {
        const endpoint = 'chat_engine_chat';
        const operationType = semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK;
        return (originalMethod) => {
            return function (...args) {
                const requestModel = LlamaIndexWrapper._extractModel(this);
                const { address, port } = LlamaIndexWrapper._extractServerInfo(this?.llm || this?._llm || this);
                const workflowName = this?.constructor?.name || 'chat_engine';
                const spanName = `${operationType} ${workflowName}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.INTERNAL,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
                        [semantic_convention_1.default.GEN_AI_WORKFLOW_NAME]: workflowName,
                    },
                });
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    const startTime = Date.now();
                    const onSuccess = (response) => {
                        try {
                            const duration = (Date.now() - startTime) / 1000;
                            base_wrapper_1.default.setBaseSpanAttributes(span, {
                                genAIEndpoint: endpoint,
                                model: requestModel,
                                aiSystem: LlamaIndexWrapper.aiSystem,
                                serverAddress: address,
                                serverPort: port,
                            });
                            span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
                            if (config_1.default.captureMessageContent) {
                                const messageInput = args[0];
                                const message = typeof messageInput === 'string'
                                    ? messageInput
                                    : messageInput?.message || messageInput?.content || '';
                                span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages([{ role: 'user', content: message }]));
                                const responseContent = response?.message?.content
                                    || (typeof response?.response === 'string' ? response.response : '')
                                    || response?.toString?.() || '';
                                span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, helpers_1.default.buildOutputMessages(responseContent, 'stop'));
                            }
                            base_wrapper_1.default.recordMetrics(span, {
                                genAIEndpoint: endpoint,
                                model: requestModel,
                                aiSystem: LlamaIndexWrapper.aiSystem,
                                serverAddress: address,
                                serverPort: port,
                            });
                        }
                        catch { /* swallow */ }
                        span.end();
                        return response;
                    };
                    const onError = (e) => {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint: endpoint,
                            model: requestModel,
                            aiSystem: LlamaIndexWrapper.aiSystem,
                            serverAddress: address,
                            serverPort: port,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
                        span.end();
                        throw e;
                    };
                    try {
                        const result = originalMethod.apply(this, args);
                        if (result && typeof result.then === 'function') {
                            return result.then(onSuccess).catch(onError);
                        }
                        return onSuccess(result);
                    }
                    catch (e) {
                        return onError(e);
                    }
                });
            };
        };
    }
    // ---------------------------------------------------------------------------
    // Retriever retrieve patch — retrieval span
    // Mirrors Python: BaseRetriever.retrieve -> operation_type "retrieval"
    // ---------------------------------------------------------------------------
    static _patchRetrieverRetrieve(tracer) {
        const endpoint = 'retriever_retrieve';
        const operationType = OPERATION_MAP[endpoint];
        return (originalMethod) => {
            return function (...args) {
                const { address, port } = LlamaIndexWrapper._extractServerInfo(this);
                const spanName = `${operationType} ${endpoint}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
                    },
                });
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    const startTime = Date.now();
                    const model = LlamaIndexWrapper._extractModel(this);
                    const onSuccess = (response) => {
                        try {
                            const duration = (Date.now() - startTime) / 1000;
                            base_wrapper_1.default.setBaseSpanAttributes(span, {
                                genAIEndpoint: endpoint,
                                model,
                                aiSystem: LlamaIndexWrapper.aiSystem,
                                serverAddress: address,
                                serverPort: port,
                            });
                            span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
                            if (Array.isArray(response) && response.length > 0) {
                                span.setAttribute(semantic_convention_1.default.GEN_AI_RETRIEVAL_SOURCE, JSON.stringify(response.slice(0, 5).map((n) => ({
                                    id: n.node?.id_ || n.id_ || '',
                                    score: n.score,
                                    text: n.node?.text?.slice(0, 200) || n.text?.slice(0, 200) || '',
                                }))));
                            }
                            if (config_1.default.captureMessageContent) {
                                const queryStr = typeof args[0] === 'string'
                                    ? args[0]
                                    : args[0]?.query || args[0]?.queryStr || '';
                                span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, helpers_1.default.buildInputMessages([{ role: 'user', content: queryStr }]));
                            }
                            base_wrapper_1.default.recordMetrics(span, {
                                genAIEndpoint: endpoint,
                                model,
                                aiSystem: LlamaIndexWrapper.aiSystem,
                                serverAddress: address,
                                serverPort: port,
                            });
                        }
                        catch { /* swallow */ }
                        span.end();
                        return response;
                    };
                    const onError = (e) => {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint: endpoint,
                            model,
                            aiSystem: LlamaIndexWrapper.aiSystem,
                            serverAddress: address,
                            serverPort: port,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
                        span.end();
                        throw e;
                    };
                    try {
                        const result = originalMethod.apply(this, args);
                        if (result && typeof result.then === 'function') {
                            return result.then(onSuccess).catch(onError);
                        }
                        return onSuccess(result);
                    }
                    catch (e) {
                        return onError(e);
                    }
                });
            };
        };
    }
    // ---------------------------------------------------------------------------
    // Embedding patch — embeddings span
    // Mirrors Python: BaseEmbedding.get_text_embedding_batch -> "embeddings"
    // ---------------------------------------------------------------------------
    static _patchEmbedding(tracer, endpoint = 'embedding_generate') {
        const operationType = OPERATION_MAP[endpoint] || semantic_convention_1.default.GEN_AI_OPERATION_TYPE_EMBEDDING;
        return (originalMethod) => {
            return function (...args) {
                const model = LlamaIndexWrapper._extractModel(this);
                const { address, port } = LlamaIndexWrapper._extractServerInfo(this);
                const spanName = `${operationType} ${endpoint}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
                        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: model,
                        [semantic_convention_1.default.SERVER_ADDRESS]: address,
                        [semantic_convention_1.default.SERVER_PORT]: port,
                    },
                });
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    const startTime = Date.now();
                    const onSuccess = (response) => {
                        try {
                            const duration = (Date.now() - startTime) / 1000;
                            base_wrapper_1.default.setBaseSpanAttributes(span, {
                                genAIEndpoint: endpoint,
                                model,
                                aiSystem: LlamaIndexWrapper.aiSystem,
                                serverAddress: address,
                                serverPort: port,
                            });
                            span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
                            if (Array.isArray(response) && response.length > 0) {
                                if (Array.isArray(response[0])) {
                                    span.setAttribute(semantic_convention_1.default.GEN_AI_EMBEDDINGS_DIMENSION_COUNT, response[0].length);
                                }
                                else if (typeof response[0] === 'number') {
                                    span.setAttribute(semantic_convention_1.default.GEN_AI_EMBEDDINGS_DIMENSION_COUNT, response.length);
                                }
                            }
                            base_wrapper_1.default.recordMetrics(span, {
                                genAIEndpoint: endpoint,
                                model,
                                aiSystem: LlamaIndexWrapper.aiSystem,
                                serverAddress: address,
                                serverPort: port,
                            });
                        }
                        catch { /* swallow */ }
                        span.end();
                        return response;
                    };
                    const onError = (e) => {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint: endpoint,
                            model,
                            aiSystem: LlamaIndexWrapper.aiSystem,
                            serverAddress: address,
                            serverPort: port,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
                        span.end();
                        throw e;
                    };
                    try {
                        const result = (0, helpers_1.runWithFrameworkLlm)(() => originalMethod.apply(this, args));
                        if (result && typeof result.then === 'function') {
                            return result.then(onSuccess).catch(onError);
                        }
                        return onSuccess(result);
                    }
                    catch (e) {
                        return onError(e);
                    }
                });
            };
        };
    }
    // ---------------------------------------------------------------------------
    // Generic framework method patch — for index, document, synthesizer, etc.
    // Mirrors Python: common_llamaindex_logic with framework-level attributes
    // ---------------------------------------------------------------------------
    static _patchFrameworkMethod(tracer, endpoint) {
        const operationType = OPERATION_MAP[endpoint] || semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK;
        return (originalMethod) => {
            return function (...args) {
                const { address, port } = LlamaIndexWrapper._extractServerInfo(this);
                const spanName = `${operationType} ${endpoint}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
                    },
                });
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    const startTime = Date.now();
                    const model = LlamaIndexWrapper._extractModel(this);
                    const onSuccess = (response) => {
                        try {
                            const duration = (Date.now() - startTime) / 1000;
                            base_wrapper_1.default.setBaseSpanAttributes(span, {
                                genAIEndpoint: endpoint,
                                model,
                                aiSystem: LlamaIndexWrapper.aiSystem,
                                serverAddress: address,
                                serverPort: port,
                            });
                            span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
                            base_wrapper_1.default.recordMetrics(span, {
                                genAIEndpoint: endpoint,
                                model,
                                aiSystem: LlamaIndexWrapper.aiSystem,
                                serverAddress: address,
                                serverPort: port,
                            });
                        }
                        catch { /* swallow */ }
                        span.end();
                        return response;
                    };
                    const onError = (e) => {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint: endpoint,
                            model,
                            aiSystem: LlamaIndexWrapper.aiSystem,
                            serverAddress: address,
                            serverPort: port,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
                        span.end();
                        throw e;
                    };
                    try {
                        const result = originalMethod.apply(this, args);
                        if (result && typeof result.then === 'function') {
                            return result.then(onSuccess).catch(onError);
                        }
                        return onSuccess(result);
                    }
                    catch (e) {
                        return onError(e);
                    }
                });
            };
        };
    }
}
LlamaIndexWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_LLAMAINDEX;
exports.default = LlamaIndexWrapper;
//# sourceMappingURL=wrapper.js.map