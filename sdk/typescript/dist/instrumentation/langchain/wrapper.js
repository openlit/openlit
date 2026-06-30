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
exports.runWithFrameworkLlm = exports.OpenLITCallbackHandler = void 0;
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importStar(require("../../helpers"));
Object.defineProperty(exports, "runWithFrameworkLlm", { enumerable: true, get: function () { return helpers_1.runWithFrameworkLlm; } });
const constant_1 = require("../../constant");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
// ---------------------------------------------------------------------------
// Provider detection (mirrors Python PROVIDER_MAP)
// ---------------------------------------------------------------------------
const PROVIDER_MAP = {
    anthropic: 'anthropic',
    azure: 'azure',
    bedrock: 'aws.bedrock',
    bedrock_converse: 'aws.bedrock',
    cohere: 'cohere',
    google: 'google',
    google_genai: 'google',
    google_vertexai: 'google',
    groq: 'groq',
    mistralai: 'mistral_ai',
    ollama: 'ollama',
    openai: 'openai',
    together: 'together',
    vertexai: 'google',
    fireworks: 'fireworks',
    perplexity: 'perplexity',
    huggingface: 'huggingface',
    deepinfra: 'deepinfra',
    anyscale: 'anyscale',
};
function detectProvider(serialized) {
    if (!serialized)
        return semantic_convention_1.default.GEN_AI_SYSTEM_LANGCHAIN;
    const classId = serialized.id || [];
    if (Array.isArray(classId)) {
        const classPath = classId.join('.').toLowerCase();
        for (const [key, val] of Object.entries(PROVIDER_MAP)) {
            if (classPath.includes(key))
                return val;
        }
    }
    return semantic_convention_1.default.GEN_AI_SYSTEM_LANGCHAIN;
}
// ---------------------------------------------------------------------------
// Model name extraction (mirrors Python extract_model_name)
// ---------------------------------------------------------------------------
const MODEL_PATHS_BY_ID = [
    ['ChatGoogleGenerativeAI', ['kwargs', 'model'], 'serialized'],
    ['ChatVertexAI', ['kwargs', 'model_name'], 'serialized'],
    ['ChatMistralAI', ['kwargs', 'model'], 'serialized'],
    ['OpenAI', ['invocation_params', 'model_name'], 'kwargs'],
    ['ChatOpenAI', ['invocation_params', 'model_name'], 'kwargs'],
    ['AzureChatOpenAI', ['invocation_params', 'model'], 'kwargs'],
    ['AzureChatOpenAI', ['invocation_params', 'model_name'], 'kwargs'],
    ['AzureChatOpenAI', ['invocation_params', 'azure_deployment'], 'kwargs'],
    ['HuggingFacePipeline', ['invocation_params', 'model_id'], 'kwargs'],
    ['BedrockChat', ['kwargs', 'model_id'], 'serialized'],
    ['Bedrock', ['kwargs', 'model_id'], 'serialized'],
    ['BedrockLLM', ['kwargs', 'model_id'], 'serialized'],
    ['ChatBedrock', ['kwargs', 'model_id'], 'serialized'],
    ['ChatBedrockConverse', ['kwargs', 'model_id'], 'serialized'],
    ['LlamaCpp', ['invocation_params', 'model_path'], 'kwargs'],
    ['WatsonxLLM', ['invocation_params', 'model_id'], 'kwargs'],
];
const MODEL_PATTERNS = [
    ['ChatAnthropic', 'model', 'anthropic'],
    ['Anthropic', 'model', 'anthropic'],
    ['ChatTongyi', 'model_name', null],
    ['ChatCohere', 'model', null],
    ['Cohere', 'model', null],
    ['HuggingFaceHub', 'model', null],
    ['ChatAnyscale', 'model_name', null],
    ['TextGen', 'model', 'text-gen'],
    ['Ollama', 'model', null],
    ['OllamaLLM', 'model', null],
    ['ChatOllama', 'model', null],
    ['ChatFireworks', 'model', null],
    ['ChatPerplexity', 'model', null],
    ['VLLM', 'model', null],
    ['Xinference', 'model_uid', null],
    ['ChatOCIGenAI', 'model_id', null],
    ['DeepInfra', 'model_id', null],
];
const FALLBACK_PATHS = [
    [['kwargs', 'model_name'], 'serialized'],
    [['kwargs', 'model'], 'serialized'],
    [['kwargs', 'model_id'], 'serialized'],
    [['invocation_params', 'model_name'], 'kwargs'],
    [['invocation_params', 'model'], 'kwargs'],
    [['invocation_params', 'model_id'], 'kwargs'],
];
function _extractByPath(serialized, kwargs, keys, selectFrom) {
    let obj = selectFrom === 'kwargs' ? kwargs : serialized;
    if (obj == null)
        return null;
    for (const key of keys) {
        if (typeof obj === 'object' && obj !== null) {
            obj = obj[key];
        }
        else {
            return null;
        }
        if (obj == null)
            return null;
    }
    return obj ? String(obj) : null;
}
function _getClassName(serialized) {
    if (!serialized)
        return null;
    const id = serialized.id;
    if (Array.isArray(id) && id.length > 0)
        return id[id.length - 1];
    return null;
}
function _extractModelFromRepr(serialized, pattern) {
    if (!serialized)
        return null;
    const repr = serialized.repr || '';
    if (repr) {
        const re = new RegExp(`${pattern}='(.*?)'`);
        const match = re.exec(repr);
        if (match)
            return match[1];
    }
    return null;
}
function extractModelName(serialized, kwargs) {
    const className = _getClassName(serialized);
    for (const [modelId, keys, selectFrom] of MODEL_PATHS_BY_ID) {
        if (className === modelId) {
            const result = _extractByPath(serialized, kwargs, keys, selectFrom);
            if (result)
                return result;
        }
    }
    for (const [modelId, pattern, defaultVal] of MODEL_PATTERNS) {
        if (className === modelId) {
            const result = _extractModelFromRepr(serialized, pattern);
            if (result)
                return result;
            if (defaultVal)
                return defaultVal;
        }
    }
    for (const [keys, selectFrom] of FALLBACK_PATHS) {
        const result = _extractByPath(serialized, kwargs, keys, selectFrom);
        if (result)
            return result;
    }
    return className || 'unknown';
}
function extractModelParameters(kwargs) {
    const params = {};
    const ip = kwargs?.invocation_params || {};
    const paramKeys = [
        'temperature', 'max_tokens', 'max_completion_tokens',
        'top_p', 'top_k', 'frequency_penalty', 'presence_penalty',
        'request_timeout', 'stop_sequences', 'seed',
    ];
    for (const key of paramKeys) {
        if (ip[key] != null)
            params[key] = ip[key];
    }
    return params;
}
// ---------------------------------------------------------------------------
// Chain type detection (mirrors Python)
// ---------------------------------------------------------------------------
const SKIP_CHAIN_CLASS_PREFIXES = new Set([
    'RunnableSequence', 'RunnableParallel', 'RunnableLambda',
    'RunnablePassthrough', 'RunnableAssign', 'RunnablePick',
    'RunnableBranch', 'RunnableEach', 'Prompt', 'PromptTemplate',
    'ChatPromptTemplate', 'MessagesPlaceholder',
    'SystemMessagePromptTemplate', 'HumanMessagePromptTemplate',
    'AIMessagePromptTemplate', 'BasePromptTemplate',
    'StrOutputParser', 'JsonOutputParser', 'PydanticOutputParser',
]);
function isInternalChain(serialized, name) {
    if (serialized?.id) {
        const classPath = serialized.id;
        if (Array.isArray(classPath) && classPath.length > 0) {
            const cn = String(classPath[classPath.length - 1]);
            if (SKIP_CHAIN_CLASS_PREFIXES.has(cn))
                return true;
            if (cn.startsWith('Runnable'))
                return true;
        }
    }
    if (SKIP_CHAIN_CLASS_PREFIXES.has(name))
        return true;
    return false;
}
function detectObservationType(serialized, callbackType, name) {
    if (callbackType === 'tool')
        return 'tool';
    if (callbackType === 'retriever')
        return 'retriever';
    if (callbackType === 'llm')
        return 'generation';
    if (callbackType === 'chain') {
        if (serialized?.id) {
            const classPath = serialized.id;
            if (classPath.some((part) => String(part).toLowerCase().includes('agent'))) {
                return 'agent';
            }
        }
        if (name && name.toLowerCase().includes('agent'))
            return 'agent';
        return 'chain';
    }
    return 'span';
}
// ---------------------------------------------------------------------------
// Message formatting helpers (mirrors Python utils.py)
// ---------------------------------------------------------------------------
const ROLE_MAP = helpers_1.LANGCHAIN_ROLE_MAP;
function buildInputMessagesFromLangChain(messages) {
    try {
        const structured = [];
        for (const msgList of messages) {
            for (const msg of msgList) {
                const role = msg._getType?.() || msg.type || 'user';
                const content = msg.content ?? String(msg);
                const otelRole = ROLE_MAP[role] || 'user';
                structured.push({ role: otelRole, parts: buildParts(content) });
            }
        }
        return structured;
    }
    catch {
        return [];
    }
}
function buildInputMessagesFromPrompts(prompts) {
    try {
        return prompts.map(p => ({
            role: 'user',
            parts: [{ type: 'text', content: typeof p === 'string' ? p : String(p) }],
        }));
    }
    catch {
        return [];
    }
}
function buildInputMessages(messagesOrPrompts) {
    if (!messagesOrPrompts)
        return [];
    if (Array.isArray(messagesOrPrompts) && messagesOrPrompts.length > 0) {
        const first = messagesOrPrompts[0];
        if (typeof first === 'string')
            return buildInputMessagesFromPrompts(messagesOrPrompts);
        if (Array.isArray(first) && first.length > 0 && first[0]?.content !== undefined) {
            return buildInputMessagesFromLangChain(messagesOrPrompts);
        }
        return buildInputMessagesFromPrompts(messagesOrPrompts);
    }
    return [];
}
function buildParts(content) {
    if (typeof content === 'string')
        return [{ type: 'text', content }];
    if (Array.isArray(content)) {
        const parts = [];
        for (const part of content) {
            if (typeof part === 'string') {
                parts.push({ type: 'text', content: part });
            }
            else if (typeof part === 'object' && part !== null) {
                const ptype = part.type || 'text';
                if (ptype === 'text') {
                    parts.push({ type: 'text', content: part.text || '' });
                }
                else if (ptype === 'image_url') {
                    const url = part.image_url;
                    if (typeof url === 'string')
                        parts.push({ type: 'image', url });
                    else if (url?.url)
                        parts.push({ type: 'image', url: url.url });
                }
                else {
                    parts.push({ type: ptype, content: String(part) });
                }
            }
        }
        return parts.length > 0 ? parts : [{ type: 'text', content: '' }];
    }
    return [{ type: 'text', content: String(content) }];
}
function shouldCaptureMessageContent() {
    return config_1.default.captureMessageContent ?? config_1.default.traceContent ?? true;
}
function normalizeToolCalls(rawToolCalls) {
    return rawToolCalls.map((call) => ({
        id: call?.id || call?.tool_call_id || '',
        type: call?.type || 'function',
        name: call?.name || call?.function?.name || '',
        arguments: call?.args ?? call?.arguments ?? call?.function?.arguments ?? {},
    }));
}
function stringifyToolCallArgument(value) {
    if (typeof value === 'string')
        return value;
    try {
        return JSON.stringify(value ?? {});
    }
    catch {
        return '[unserializable]';
    }
}
// ---------------------------------------------------------------------------
// Conversation ID extraction (mirrors Python _resolve_conversation_id)
// ---------------------------------------------------------------------------
function resolveConversationId(metadata) {
    if (!metadata)
        return null;
    for (const key of ['thread_id', 'conversation_id', 'session_id']) {
        if (metadata[key])
            return String(metadata[key]);
    }
    const configurable = metadata.configurable || {};
    for (const key of ['thread_id', 'conversation_id']) {
        if (configurable[key])
            return String(configurable[key]);
    }
    return null;
}
// ---------------------------------------------------------------------------
// Token calculation (approximate, mirrors Python general_tokens)
// ---------------------------------------------------------------------------
function generalTokens(text) {
    return Math.ceil(text.length / 2);
}
// ---------------------------------------------------------------------------
// Callback Handler
// ---------------------------------------------------------------------------
let handlerInstance = null;
class OpenLITCallbackHandler {
    constructor(tracer) {
        this.name = 'openlit_callback_handler';
        this.lc_serializable = false;
        this.awaitHandlers = false;
        this.spans = new Map();
        this.skippedRuns = new Map();
        this.tracer = tracer;
    }
    // ---- Helpers -----------------------------------------------------------
    _getNameFromCallback(serialized, kwargs) {
        if (kwargs?.name)
            return kwargs.name;
        if (serialized) {
            if (serialized.kwargs?.name)
                return serialized.kwargs.name;
            if (serialized.name)
                return serialized.name;
            if (serialized.id) {
                const id = serialized.id;
                if (Array.isArray(id) && id.length > 0)
                    return id[id.length - 1];
            }
        }
        return 'unknown';
    }
    _resolveParentRunId(parentRunId) {
        const visited = new Set();
        let current = parentRunId;
        while (current && this.skippedRuns.has(current)) {
            if (visited.has(current))
                break;
            visited.add(current);
            current = this.skippedRuns.get(current);
        }
        return current;
    }
    _getParentContext(parentRunId) {
        const resolved = this._resolveParentRunId(parentRunId);
        if (!resolved)
            return undefined;
        const holder = this.spans.get(resolved);
        if (!holder)
            return undefined;
        return api_1.trace.setSpan(api_1.context.active(), holder.span);
    }
    _createSpan(runId, parentRunId, spanName, kind = api_1.SpanKind.INTERNAL) {
        const resolved = this._resolveParentRunId(parentRunId);
        let parentContext;
        if (resolved && this.spans.has(resolved)) {
            parentContext = api_1.trace.setSpan(api_1.context.active(), this.spans.get(resolved).span);
        }
        return this.tracer.startSpan(spanName, { kind }, parentContext);
    }
    _newHolder(span, parentRunId) {
        return {
            span,
            startTime: Date.now(),
            modelName: 'unknown',
            modelParameters: {},
            provider: '',
            serverAddress: '',
            serverPort: 0,
            parentRunId,
            children: [],
            streamingContent: [],
            tokenTimestamps: [],
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            promptContent: '',
            inputMessagesRaw: null,
            prompts: [],
            inputMessagesStructured: [],
            systemInstructions: null,
            toolDefinitions: null,
            toolCalls: null,
            finishReason: 'stop',
            isAgentChain: false,
            responseId: null,
            suppressionActive: false,
        };
    }
    _setCommonAttributes(span, operationType) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, operationType);
        span.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, constant_1.SDK_NAME);
        span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment || 'default');
        span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName || 'default');
        span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, constant_1.SDK_VERSION);
    }
    _setModelParameters(span, params) {
        if (params.temperature != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, params.temperature);
        if (params.max_tokens != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, params.max_tokens);
        if (params.max_completion_tokens != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, params.max_completion_tokens);
        if (params.top_p != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, params.top_p);
        if (params.top_k != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_K, params.top_k);
        if (params.frequency_penalty != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, params.frequency_penalty);
        if (params.presence_penalty != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, params.presence_penalty);
        if (params.seed != null)
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_SEED, Number(params.seed));
        const stop = params.stop || params.stop_sequences;
        if (stop) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, Array.isArray(stop) ? stop : [stop]);
        }
    }
    _endSpan(runId, error) {
        const holder = this.spans.get(runId);
        if (!holder)
            return;
        for (const childId of holder.children || []) {
            const child = this.spans.get(childId);
            if (child) {
                try {
                    child.span.end();
                }
                catch { /* already ended */ }
            }
        }
        if (error) {
            holder.span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: error });
        }
        else {
            holder.span.setStatus({ code: api_1.SpanStatusCode.OK });
        }
        holder.span.end();
        this.spans.delete(runId);
    }
    // ---- Chain Callbacks ---------------------------------------------------
    handleChainStart(chain, inputs, runId, parentRunId, _tags, metadata, _runType, name) {
        try {
            const resolvedName = this._getNameFromCallback(chain, { name });
            const obsType = detectObservationType(chain, 'chain', resolvedName);
            if (obsType !== 'agent' && isInternalChain(chain, resolvedName)) {
                this.skippedRuns.set(runId, parentRunId);
                return;
            }
            if (obsType !== 'agent' && (0, helpers_1.isLangGraphActive)() && !parentRunId) {
                this.skippedRuns.set(runId, parentRunId);
                return;
            }
            if (obsType !== 'agent' && parentRunId) {
                this.skippedRuns.set(runId, parentRunId);
                return;
            }
            const operationType = obsType === 'agent'
                ? semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT
                : semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK;
            const spanName = obsType === 'agent'
                ? `invoke_agent ${resolvedName}`
                : `invoke_workflow ${resolvedName}`;
            const span = this._createSpan(runId, parentRunId, spanName);
            const holder = this._newHolder(span, parentRunId);
            if (obsType === 'agent')
                holder.isAgentChain = true;
            this.spans.set(runId, holder);
            if (parentRunId) {
                const parentResolved = this._resolveParentRunId(parentRunId);
                if (parentResolved && this.spans.has(parentResolved)) {
                    this.spans.get(parentResolved).children.push(runId);
                }
            }
            span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, semantic_convention_1.default.GEN_AI_SYSTEM_LANGCHAIN);
            this._setCommonAttributes(span, operationType);
            if (obsType === 'agent') {
                span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, resolvedName);
                span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_ID, runId);
            }
            else {
                span.setAttribute(semantic_convention_1.default.GEN_AI_WORKFLOW_NAME, resolvedName);
            }
            const convId = resolveConversationId(metadata);
            if (convId)
                span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, convId);
            if (config_1.default.captureMessageContent && inputs) {
                try {
                    const inputStr = typeof inputs === 'string' ? inputs : JSON.stringify(inputs);
                    span.setAttribute(semantic_convention_1.default.GEN_AI_WORKFLOW_INPUT, inputStr.slice(0, 2000));
                }
                catch { /* non-blocking */ }
            }
            (0, helpers_1.applyCustomSpanAttributes)(span);
        }
        catch { /* non-blocking */ }
    }
    handleChainEnd(outputs, runId) {
        try {
            this.skippedRuns.delete(runId);
            const holder = this.spans.get(runId);
            if (!holder)
                return;
            const duration = (Date.now() - holder.startTime) / 1000;
            holder.span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
            if (config_1.default.captureMessageContent && outputs) {
                try {
                    const outputStr = typeof outputs === 'string' ? outputs : JSON.stringify(outputs);
                    holder.span.setAttribute(semantic_convention_1.default.GEN_AI_WORKFLOW_OUTPUT, outputStr.slice(0, 2000));
                }
                catch { /* non-blocking */ }
            }
            this._endSpan(runId);
        }
        catch { /* non-blocking */ }
    }
    handleChainError(error, runId) {
        try {
            this.skippedRuns.delete(runId);
            if (this.spans.has(runId)) {
                const span = this.spans.get(runId).span;
                const errorType = error?.constructor?.name || '_OTHER';
                span.setAttribute(semantic_convention_1.default.ERROR_TYPE, errorType);
            }
            this._endSpan(runId, String(error));
        }
        catch { /* non-blocking */ }
    }
    // ---- LLM Callbacks -----------------------------------------------------
    handleChatModelStart(llm, messages, runId, parentRunId, _extraParams, _tags, metadata, kwargs) {
        try {
            const modelName = extractModelName(llm, kwargs || {});
            const modelParams = extractModelParameters(kwargs || {});
            const provider = detectProvider(llm);
            const spanName = `chat ${modelName}`;
            const span = this._createSpan(runId, parentRunId, spanName, api_1.SpanKind.CLIENT);
            const holder = this._newHolder(span, parentRunId);
            holder.modelName = modelName;
            holder.modelParameters = modelParams;
            holder.provider = provider;
            holder.suppressionActive = true;
            (0, helpers_1.setFrameworkLlmActive)();
            (0, helpers_1.setFrameworkParentContext)(api_1.trace.setSpan(api_1.context.active(), span));
            this.spans.set(runId, holder);
            if (parentRunId) {
                const parentResolved = this._resolveParentRunId(parentRunId);
                if (parentResolved && this.spans.has(parentResolved)) {
                    this.spans.get(parentResolved).children.push(runId);
                }
            }
            span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, provider);
            this._setCommonAttributes(span, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT);
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, modelName);
            this._setModelParameters(span, modelParams);
            const convId = resolveConversationId(metadata);
            if (convId)
                span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, convId);
            // Server address from invocation_params or provider defaults
            const ip = kwargs?.invocation_params || {};
            const apiBase = ip.api_base || ip.base_url;
            if (apiBase) {
                try {
                    const url = new URL(apiBase);
                    holder.serverAddress = url.hostname || '';
                    holder.serverPort = url.port ? Number(url.port) : 443;
                }
                catch { /* ignore */ }
            }
            if (!holder.serverAddress) {
                const [defaultHost, defaultPort] = (0, helpers_1.getServerAddressForProvider)(provider);
                if (defaultHost) {
                    holder.serverAddress = defaultHost;
                    holder.serverPort = defaultPort;
                }
            }
            if (messages) {
                const formatted = [];
                for (const msgList of messages) {
                    for (const msg of msgList) {
                        const role = msg._getType?.() || msg.type || 'unknown';
                        const content = msg.content ?? String(msg);
                        formatted.push(`${role}: ${content}`);
                    }
                }
                const promptStr = formatted.join('\n');
                holder.promptContent = promptStr;
                holder.inputTokens = generalTokens(promptStr);
                holder.inputMessagesRaw = messages;
                if (config_1.default.captureMessageContent) {
                    // System instructions
                    const sysInstructions = [];
                    for (const msgList of messages) {
                        for (const msg of msgList) {
                            const role = msg._getType?.() || msg.type || '';
                            if (role === 'system') {
                                const content = msg.content ?? '';
                                if (content)
                                    sysInstructions.push({ type: 'text', content: String(content) });
                            }
                        }
                    }
                    if (sysInstructions.length > 0) {
                        holder.systemInstructions = sysInstructions;
                        span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, JSON.stringify(sysInstructions));
                    }
                    // Tool definitions
                    const tools = ip.tools || ip.functions;
                    if (tools && Array.isArray(tools)) {
                        holder.toolDefinitions = tools;
                        span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, JSON.stringify(tools));
                    }
                    // Structured input messages
                    try {
                        holder.inputMessagesStructured = buildInputMessages(messages);
                    }
                    catch { /* non-blocking */ }
                }
            }
            (0, helpers_1.applyCustomSpanAttributes)(span);
        }
        catch { /* non-blocking */ }
    }
    handleLLMStart(serialized, prompts, runId, parentRunId, _extraParams, _tags, metadata, kwargs) {
        try {
            const modelName = extractModelName(serialized, kwargs || {});
            const modelParams = extractModelParameters(kwargs || {});
            const provider = detectProvider(serialized);
            const spanName = `chat ${modelName}`;
            const span = this._createSpan(runId, parentRunId, spanName, api_1.SpanKind.CLIENT);
            const holder = this._newHolder(span, parentRunId);
            holder.modelName = modelName;
            holder.modelParameters = modelParams;
            holder.provider = provider;
            holder.prompts = prompts || [];
            holder.suppressionActive = true;
            (0, helpers_1.setFrameworkLlmActive)();
            (0, helpers_1.setFrameworkParentContext)(api_1.trace.setSpan(api_1.context.active(), span));
            this.spans.set(runId, holder);
            if (parentRunId) {
                const parentResolved = this._resolveParentRunId(parentRunId);
                if (parentResolved && this.spans.has(parentResolved)) {
                    this.spans.get(parentResolved).children.push(runId);
                }
            }
            span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, provider);
            this._setCommonAttributes(span, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT);
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, modelName);
            this._setModelParameters(span, modelParams);
            const convId = resolveConversationId(metadata);
            if (convId)
                span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, convId);
            // Server address
            const ip = kwargs?.invocation_params || {};
            const apiBase = ip.api_base || ip.base_url;
            if (apiBase) {
                try {
                    const url = new URL(apiBase);
                    holder.serverAddress = url.hostname || '';
                    holder.serverPort = url.port ? Number(url.port) : 443;
                }
                catch { /* ignore */ }
            }
            if (!holder.serverAddress) {
                const [defaultHost, defaultPort] = (0, helpers_1.getServerAddressForProvider)(provider);
                if (defaultHost) {
                    holder.serverAddress = defaultHost;
                    holder.serverPort = defaultPort;
                }
            }
            if (prompts && prompts.length > 0) {
                const promptStr = prompts.join('\n');
                holder.inputTokens = generalTokens(promptStr);
                if (config_1.default.captureMessageContent) {
                    try {
                        holder.inputMessagesStructured = buildInputMessages(prompts);
                    }
                    catch { /* non-blocking */ }
                }
            }
            (0, helpers_1.applyCustomSpanAttributes)(span);
        }
        catch { /* non-blocking */ }
    }
    handleLLMNewToken(token, _idx, runId, _chunk) {
        try {
            const holder = this.spans.get(runId);
            if (!holder)
                return;
            const now = Date.now();
            if (!holder.firstTokenTime)
                holder.firstTokenTime = now;
            holder.tokenTimestamps.push(now);
            if (token)
                holder.streamingContent.push(token);
        }
        catch { /* non-blocking */ }
    }
    handleLLMEnd(output, runId) {
        try {
            const holder = this.spans.get(runId);
            if (!holder)
                return;
            const { span, startTime, modelName, modelParameters = {}, streamingContent = [], tokenTimestamps = [], firstTokenTime, } = holder;
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
            const isStreaming = streamingContent.length > 0;
            let ttft = 0;
            let tbt = 0;
            if (isStreaming) {
                if (firstTokenTime)
                    ttft = (firstTokenTime - startTime) / 1000;
                if (tokenTimestamps.length > 1) {
                    const diffs = tokenTimestamps.slice(1).map((t, i) => t - tokenTimestamps[i]);
                    tbt = diffs.reduce((a, b) => a + b, 0) / diffs.length / 1000;
                }
            }
            else {
                ttft = duration;
            }
            // Extract tokens and content from output
            let inputTokens = holder.inputTokens;
            let outputTokens = 0;
            let completionContent = streamingContent.join('');
            let responseModel = modelName;
            let responseId = null;
            // From llm_output (top-level)
            if (output?.llm_output) {
                const lu = output.llm_output;
                const tu = lu.token_usage || lu.usage || {};
                inputTokens = tu.prompt_tokens || tu.input_tokens || inputTokens;
                outputTokens = tu.completion_tokens || tu.output_tokens || outputTokens;
                responseModel = lu.model_name || lu.model || modelName;
                responseId = lu.id || null;
                // Cache token extraction
                const promptDetails = tu.prompt_tokens_details || tu.input_tokens_details || {};
                let cached = promptDetails.cached_tokens || 0;
                const inputDetails = tu.input_tokens_details || {};
                let creation = inputDetails.cache_creation_tokens || 0;
                const langchainInput = tu.input_token_details || {};
                if (!cached)
                    cached = langchainInput.cache_read || 0;
                if (!creation)
                    creation = langchainInput.cache_creation || 0;
                holder.cacheReadInputTokens = cached;
                holder.cacheCreationInputTokens = creation;
            }
            // From generations
            const generations = output?.generations || [];
            for (const genList of generations) {
                for (const gen of (Array.isArray(genList) ? genList : [genList])) {
                    const msg = gen?.message || gen;
                    // Usage from usage_metadata
                    const um = msg?.usage_metadata;
                    if (um) {
                        if (!inputTokens)
                            inputTokens = um.input_tokens || um.prompt_tokens || 0;
                        if (!outputTokens)
                            outputTokens = um.output_tokens || um.completion_tokens || 0;
                        // Cache tokens from usage_metadata
                        const pd = um.prompt_tokens_details || um.input_tokens_details || {};
                        if (!holder.cacheReadInputTokens)
                            holder.cacheReadInputTokens = pd.cached_tokens || 0;
                        const langchainInput = um.input_token_details || {};
                        if (!holder.cacheReadInputTokens)
                            holder.cacheReadInputTokens = langchainInput.cache_read || 0;
                        if (!holder.cacheCreationInputTokens)
                            holder.cacheCreationInputTokens = langchainInput.cache_creation || 0;
                    }
                    // Token usage from response_metadata
                    if (msg?.response_metadata) {
                        const rm = msg.response_metadata;
                        const tokenUsage = rm.token_usage;
                        if (tokenUsage) {
                            inputTokens = tokenUsage.prompt_tokens || tokenUsage.input_tokens || inputTokens;
                            outputTokens = tokenUsage.completion_tokens || tokenUsage.output_tokens || outputTokens;
                        }
                        if (rm.usage) {
                            inputTokens = rm.usage.inputTokens || rm.usage.input_tokens || inputTokens;
                            outputTokens = rm.usage.outputTokens || rm.usage.output_tokens || outputTokens;
                        }
                        if (rm['amazon-bedrock-invocationMetrics']) {
                            const bm = rm['amazon-bedrock-invocationMetrics'];
                            inputTokens = bm.inputTokenCount || inputTokens;
                            outputTokens = bm.outputTokenCount || outputTokens;
                        }
                    }
                    // Content
                    const genContent = gen?.text || msg?.content;
                    if (genContent && typeof genContent === 'string' && genContent.length > completionContent.length) {
                        completionContent = genContent;
                    }
                    // Finish reason
                    const fr = gen?.generationInfo?.finish_reason || msg?.response_metadata?.finish_reason;
                    if (fr)
                        holder.finishReason = fr;
                    // Tool calls. Keep last-writer-wins semantics across generations so
                    // choices are not merged into one assistant message.
                    const tc = msg?.tool_calls || msg?.additional_kwargs?.tool_calls || gen?.message?.tool_calls;
                    if (tc && Array.isArray(tc) && tc.length > 0) {
                        holder.toolCalls = normalizeToolCalls(tc);
                    }
                }
            }
            // Fallback token estimation
            if (!outputTokens && completionContent)
                outputTokens = generalTokens(completionContent);
            if (!inputTokens && holder.promptContent)
                inputTokens = generalTokens(holder.promptContent);
            // Cost
            const pricingInfo = config_1.default.pricingInfo || {};
            // LangChain's normalized usage reports input_tokens as the sum of all
            // input token types (uncached + cache read + cache creation), so flag the
            // prompt tokens as cache-inclusive to avoid billing cached tokens twice.
            const cost = helpers_1.default.getChatModelCost(modelName, pricingInfo, inputTokens, outputTokens, holder.cacheReadInputTokens || 0, holder.cacheCreationInputTokens || 0, true);
            // Provider for span attributes
            const provider = holder.provider || semantic_convention_1.default.GEN_AI_SYSTEM_LANGCHAIN;
            const serverAddress = holder.serverAddress || '';
            const serverPort = holder.serverPort || 0;
            // Set span attributes
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, responseModel);
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
            span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE, inputTokens + outputTokens);
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_COST, cost);
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [holder.finishReason]);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, typeof completionContent === 'string' ? 'text' : 'json');
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, isStreaming);
            if (responseId)
                span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, responseId);
            if (serverAddress) {
                span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, serverAddress);
                span.setAttribute(semantic_convention_1.default.SERVER_PORT, serverPort);
            }
            if (isStreaming && ttft > 0) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
                if (tbt > 0)
                    span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
            }
            // Cache tokens
            if (holder.cacheReadInputTokens) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, holder.cacheReadInputTokens);
            }
            if (holder.cacheCreationInputTokens) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, holder.cacheCreationInputTokens);
            }
            // Tool calls on span
            if (holder.toolCalls && holder.toolCalls.length > 0) {
                const names = holder.toolCalls.map((t) => t.name || t.function?.name || '').filter(Boolean);
                const ids = holder.toolCalls.map((t) => t.id || '').filter(Boolean);
                const args = holder.toolCalls.map((t) => stringifyToolCallArgument(t.arguments ?? t.function?.arguments));
                if (names.length)
                    span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, names.join(', '));
                if (ids.length)
                    span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, ids.join(', '));
                if (args.length)
                    span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ARGUMENTS, args);
            }
            let outputMessagesJson = null;
            // Content attributes (gated by captureMessageContent)
            if (shouldCaptureMessageContent()) {
                const inputRaw = holder.inputMessagesRaw || holder.prompts || [];
                const inputMessagesStructured = holder.inputMessagesStructured || [];
                const inputMsgs = inputMessagesStructured.length > 0
                    ? inputMessagesStructured
                    : buildInputMessages(inputRaw);
                const outputToolCalls = holder.toolCalls && holder.toolCalls.length > 0 ? holder.toolCalls : undefined;
                outputMessagesJson = helpers_1.default.buildOutputMessages(completionContent, holder.finishReason, outputToolCalls);
                if (inputMsgs.length > 0)
                    span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, JSON.stringify(inputMsgs));
                if (outputMessagesJson && (outputMessagesJson !== '[]' || completionContent || outputToolCalls)) {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
                }
            }
            // Emit inference event (always emitted; content within is gated)
            const eventAttrs = {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: modelName,
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: responseModel,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: [holder.finishReason],
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: typeof completionContent === 'string' ? 'text' : 'json',
            };
            if (serverAddress)
                eventAttrs[semantic_convention_1.default.SERVER_ADDRESS] = serverAddress;
            if (serverPort)
                eventAttrs[semantic_convention_1.default.SERVER_PORT] = serverPort;
            if (responseId)
                eventAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_ID] = responseId;
            if (shouldCaptureMessageContent()) {
                const inputRaw = holder.inputMessagesRaw || holder.prompts || [];
                const inputMessagesStructured = holder.inputMessagesStructured || [];
                const inputMsgs = inputMessagesStructured.length > 0
                    ? inputMessagesStructured
                    : buildInputMessages(inputRaw);
                if (inputMsgs.length > 0)
                    eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = JSON.stringify(inputMsgs);
                if (outputMessagesJson && outputMessagesJson !== '[]')
                    eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
                if (holder.systemInstructions) {
                    eventAttrs[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS] = JSON.stringify(holder.systemInstructions);
                }
                if (holder.toolDefinitions) {
                    eventAttrs[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS] = JSON.stringify(holder.toolDefinitions);
                }
                // Request params for event
                for (const [k, attr] of [
                    ['temperature', semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE],
                    ['top_p', semantic_convention_1.default.GEN_AI_REQUEST_TOP_P],
                    ['frequency_penalty', semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY],
                    ['presence_penalty', semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY],
                ]) {
                    if (modelParameters[k] != null)
                        eventAttrs[attr] = modelParameters[k];
                }
                const maxT = modelParameters.max_tokens || modelParameters.max_completion_tokens;
                if (maxT != null)
                    eventAttrs[semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS] = maxT;
            }
            if (typeof helpers_1.default.emitInferenceEvent === 'function') {
                helpers_1.default.emitInferenceEvent(span, eventAttrs);
            }
            // Record metrics
            const metricParams = {
                genAIEndpoint: 'langchain.chat_model',
                model: responseModel,
                cost,
                aiSystem: provider,
                serverAddress,
                serverPort,
            };
            base_wrapper_1.default.recordMetrics(span, metricParams);
            if (holder.suppressionActive) {
                (0, helpers_1.resetFrameworkLlmActive)();
                (0, helpers_1.clearFrameworkParentContext)();
            }
            this._endSpan(runId);
        }
        catch { /* non-blocking */ }
    }
    handleLLMError(error, runId) {
        try {
            const holder = this.spans.get(runId);
            if (!holder)
                return;
            if (holder.suppressionActive) {
                (0, helpers_1.resetFrameworkLlmActive)();
                (0, helpers_1.clearFrameworkParentContext)();
            }
            const errorType = error?.constructor?.name || '_OTHER';
            holder.span.setAttribute(semantic_convention_1.default.ERROR_TYPE, errorType);
            helpers_1.default.handleException(holder.span, error instanceof Error ? error : new Error(String(error)));
            this._endSpan(runId, String(error));
        }
        catch { /* non-blocking */ }
    }
    // ---- Tool Callbacks ----------------------------------------------------
    handleToolStart(tool, input, runId, parentRunId, _tags, metadata, kwargs) {
        try {
            const name = this._getNameFromCallback(tool, kwargs || {});
            const spanName = `execute_tool ${name}`;
            const span = this._createSpan(runId, parentRunId, spanName);
            const holder = this._newHolder(span, parentRunId);
            this.spans.set(runId, holder);
            if (parentRunId) {
                const parentResolved = this._resolveParentRunId(parentRunId);
                if (parentResolved && this.spans.has(parentResolved)) {
                    this.spans.get(parentResolved).children.push(runId);
                }
            }
            span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, semantic_convention_1.default.GEN_AI_SYSTEM_LANGCHAIN);
            this._setCommonAttributes(span, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS);
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_NAME, name);
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_TYPE_OTEL, 'function');
            span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, runId);
            const description = tool?.description;
            if (description)
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DESCRIPTION, String(description));
            const convId = resolveConversationId(metadata);
            if (convId)
                span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, convId);
            if (config_1.default.captureMessageContent && input) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ARGUMENTS, String(input).slice(0, 2000));
            }
            (0, helpers_1.applyCustomSpanAttributes)(span);
        }
        catch { /* non-blocking */ }
    }
    handleToolEnd(output, runId) {
        try {
            const holder = this.spans.get(runId);
            if (!holder)
                return;
            const duration = (Date.now() - holder.startTime) / 1000;
            holder.span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
            // Extract tool_call_id from output if available
            if (output?.tool_call_id) {
                holder.span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, output.tool_call_id);
            }
            if (config_1.default.captureMessageContent && output) {
                holder.span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_CALL_RESULT, String(output).slice(0, 2000));
            }
            this._endSpan(runId);
        }
        catch { /* non-blocking */ }
    }
    handleToolError(error, runId) {
        try {
            if (this.spans.has(runId)) {
                const span = this.spans.get(runId).span;
                const errorType = error?.constructor?.name || '_OTHER';
                span.setAttribute(semantic_convention_1.default.ERROR_TYPE, errorType);
            }
            this._endSpan(runId, String(error));
        }
        catch { /* non-blocking */ }
    }
    // ---- Retriever Callbacks -----------------------------------------------
    handleRetrieverStart(retriever, query, runId, parentRunId, _tags, metadata, kwargs) {
        try {
            const name = this._getNameFromCallback(retriever, kwargs || {});
            const spanName = `retrieval ${name}`;
            const span = this._createSpan(runId, parentRunId, spanName, api_1.SpanKind.CLIENT);
            const holder = this._newHolder(span, parentRunId);
            this.spans.set(runId, holder);
            if (parentRunId) {
                const parentResolved = this._resolveParentRunId(parentRunId);
                if (parentResolved && this.spans.has(parentResolved)) {
                    this.spans.get(parentResolved).children.push(runId);
                }
            }
            span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, semantic_convention_1.default.GEN_AI_SYSTEM_LANGCHAIN);
            this._setCommonAttributes(span, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_RETRIEVE);
            span.setAttribute(semantic_convention_1.default.GEN_AI_DATA_SOURCE_ID, name);
            const convId = resolveConversationId(metadata);
            if (convId)
                span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, convId);
            if (config_1.default.captureMessageContent && query) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_RETRIEVAL_QUERY_TEXT, String(query).slice(0, 2000));
            }
            (0, helpers_1.applyCustomSpanAttributes)(span);
        }
        catch { /* non-blocking */ }
    }
    handleRetrieverEnd(documents, runId) {
        try {
            const holder = this.spans.get(runId);
            if (!holder)
                return;
            const duration = (Date.now() - holder.startTime) / 1000;
            holder.span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
            holder.span.setAttribute(semantic_convention_1.default.GEN_AI_RETRIEVAL_DOCUMENT_COUNT, documents?.length || 0);
            if (config_1.default.captureMessageContent && documents?.length > 0) {
                const structured = documents.slice(0, 3).map((doc) => {
                    const content = doc?.pageContent || doc?.page_content || String(doc);
                    const entry = { content: String(content).slice(0, 2000) };
                    const meta = doc?.metadata;
                    if (meta) {
                        const docId = meta.id || meta.source;
                        if (docId)
                            entry.id = String(docId);
                    }
                    return entry;
                });
                holder.span.setAttribute(semantic_convention_1.default.GEN_AI_RETRIEVAL_DOCUMENTS, JSON.stringify(structured));
            }
            this._endSpan(runId);
        }
        catch { /* non-blocking */ }
    }
    handleRetrieverError(error, runId) {
        try {
            if (this.spans.has(runId)) {
                const span = this.spans.get(runId).span;
                const errorType = error?.constructor?.name || '_OTHER';
                span.setAttribute(semantic_convention_1.default.ERROR_TYPE, errorType);
            }
            this._endSpan(runId, String(error));
        }
        catch { /* non-blocking */ }
    }
    // ---- Agent Callbacks ---------------------------------------------------
    handleAgentAction(action, runId) {
        try {
            const holder = this.spans.get(runId);
            if (!holder)
                return;
            holder.span.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT);
            if (config_1.default.captureMessageContent) {
                const tool = action?.tool ?? String(action);
                const toolInput = action?.tool_input ?? '';
                const log = action?.log ?? '';
                holder.span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_ACTION_TOOL, String(tool).slice(0, 2000));
                holder.span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_ACTION_TOOL_INPUT, String(toolInput).slice(0, 2000));
                if (log)
                    holder.span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_ACTION_LOG, String(log).slice(0, 2000));
            }
        }
        catch { /* non-blocking */ }
    }
    handleAgentFinish(finish, runId) {
        try {
            const holder = this.spans.get(runId);
            if (!holder)
                return;
            if (config_1.default.captureMessageContent) {
                const output = finish?.return_values ?? String(finish);
                const log = finish?.log ?? '';
                holder.span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_FINISH_OUTPUT, String(output).slice(0, 2000));
                if (log)
                    holder.span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_FINISH_LOG, String(log).slice(0, 2000));
            }
        }
        catch { /* non-blocking */ }
    }
}
exports.OpenLITCallbackHandler = OpenLITCallbackHandler;
// ---------------------------------------------------------------------------
// Wrapper factory that patches CallbackManager._configureSync
// ---------------------------------------------------------------------------
class LangChainWrapper extends base_wrapper_1.default {
    static _patchConfigure(tracer) {
        if (!handlerInstance) {
            handlerInstance = new OpenLITCallbackHandler(tracer);
        }
        const handler = handlerInstance;
        /**
         * The LLM call itself must run inside runWithFrameworkLlm() so that
         * provider wrappers (OpenAI, Anthropic, etc.) skip their own span
         * creation. We achieve this by wrapping _configureSync: when
         * LangChain configures callbacks for an LLM call, the callback
         * handler's handleChatModelStart/handleLLMStart already sets the
         * suppression flag via the span holder. But to actually suppress
         * the provider wrapper, we need the flag in the AsyncLocalStorage
         * context of the LLM call. Since LangChain doesn't give us a
         * hook around the actual LLM invocation, we rely on the provider
         * wrappers checking isFrameworkLlmActive() which is set during
         * the configure phase and active throughout the call chain.
         */
        return (originalConfigure) => {
            return function (inheritableHandlers, ...rest) {
                if (Array.isArray(inheritableHandlers) || !inheritableHandlers) {
                    const handlers = inheritableHandlers ? [...inheritableHandlers] : [];
                    if (!handlers.some((h) => h?.name === 'openlit_callback_handler')) {
                        handlers.unshift(handler);
                    }
                    return originalConfigure.call(this, handlers, ...rest);
                }
                else {
                    const cbManager = inheritableHandlers;
                    if (cbManager?.handlers && !cbManager.handlers.some((h) => h?.name === 'openlit_callback_handler')) {
                        cbManager.addHandler(handler, true);
                    }
                    return originalConfigure.call(this, cbManager, ...rest);
                }
            };
        };
    }
}
exports.default = LangChainWrapper;
//# sourceMappingURL=wrapper.js.map