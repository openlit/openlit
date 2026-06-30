"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTEL_ASSISTANT_ROLE = exports.LANGCHAIN_ROLE_MAP = void 0;
exports.isFrameworkLlmActive = isFrameworkLlmActive;
exports.runWithFrameworkLlm = runWithFrameworkLlm;
exports.setFrameworkLlmActive = setFrameworkLlmActive;
exports.resetFrameworkLlmActive = resetFrameworkLlmActive;
exports.getCurrentAgentVersion = getCurrentAgentVersion;
exports.setAgentVersion = setAgentVersion;
exports.resetAgentVersion = resetAgentVersion;
exports.runWithAgentVersion = runWithAgentVersion;
exports.isLangGraphActive = isLangGraphActive;
exports.runWithLangGraph = runWithLangGraph;
exports.isCreateAgentActive = isCreateAgentActive;
exports.runWithCreateAgent = runWithCreateAgent;
exports.getLangGraphConversationId = getLangGraphConversationId;
exports.runWithLangGraphConversationId = runWithLangGraphConversationId;
exports.getFrameworkParentContext = getFrameworkParentContext;
exports.setFrameworkParentContext = setFrameworkParentContext;
exports.clearFrameworkParentContext = clearFrameworkParentContext;
exports.getServerAddressForProvider = getServerAddressForProvider;
exports.mapLangChainRole = mapLangChainRole;
exports.applyCustomSpanAttributes = applyCustomSpanAttributes;
exports.getMergedCustomAttributes = getMergedCustomAttributes;
exports.injectAdditionalAttributes = injectAdditionalAttributes;
exports.usingAttributes = usingAttributes;
const js_tiktoken_1 = require("js-tiktoken");
const crypto_1 = require("crypto");
const api_1 = require("@opentelemetry/api");
const api_logs_1 = require("@opentelemetry/api-logs");
const async_hooks_1 = require("async_hooks");
const semantic_convention_1 = __importDefault(require("./semantic-convention"));
const events_1 = __importDefault(require("./otel/events"));
const config_1 = __importDefault(require("./config"));
/**
 * AsyncLocalStorage for context-scoped custom span attributes.
 * Mirrors Python's ContextVar _custom_span_attributes, used by
 * usingAttributes() and injectAdditionalAttributes().
 */
const _customSpanAttributes = new async_hooks_1.AsyncLocalStorage();
// ---------------------------------------------------------------------------
// Framework LLM span suppression flags (mirrors Python SDK ContextVars)
// ---------------------------------------------------------------------------
const _frameworkLlmActive = new async_hooks_1.AsyncLocalStorage();
/**
 * Returns true when a framework instrumentor (LangChain, LiteLLM, etc.)
 * owns the current LLM span. Provider-level wrappers (OpenAI, Anthropic, …)
 * must skip their own span creation when this returns true.
 */
function isFrameworkLlmActive() {
    return _frameworkLlmActive.getStore() === true;
}
/**
 * Run `fn` with the framework-LLM-active flag set. All provider wrappers
 * invoked inside `fn` will see `isFrameworkLlmActive() === true`.
 */
function runWithFrameworkLlm(fn) {
    return _frameworkLlmActive.run(true, fn);
}
/**
 * Set framework-LLM-active flag in the current execution context.
 * Used by SpanProcessor-based instrumentations (Strands) where
 * the processor observes spans rather than controlling execution.
 * Mirrors Python's ContextVar.set(True) in Strands processor.
 */
function setFrameworkLlmActive() {
    _frameworkLlmActive.enterWith(true);
}
/**
 * Reset framework-LLM-active flag in the current execution context.
 * Mirrors Python's ContextVar.reset(token) in Strands processor.
 */
function resetFrameworkLlmActive() {
    _frameworkLlmActive.enterWith(false);
}
// ---------------------------------------------------------------------------
// User-supplied agent version label (mirrors Python's _current_agent_version)
// ---------------------------------------------------------------------------
const _currentAgentVersion = new async_hooks_1.AsyncLocalStorage();
/**
 * Returns the user-supplied agent version label set via
 * `OpenLit.setAgentVersion()` / `runWithAgentVersion()`, if any.
 *
 * Provider wrappers stamp this on `gen_ai.agent.version` so the server-side
 * materializer can group traces by the user's preferred label in addition to
 * the auto-computed `openlit.agent.version_hash` fingerprint.
 */
function getCurrentAgentVersion() {
    return _currentAgentVersion.getStore();
}
/**
 * Set the agent version label for the current execution context.
 *
 * IMPORTANT: this uses `AsyncLocalStorage.enterWith` which permanently
 * mutates the current async resource. Sequential requests handled on the
 * same Node worker (or reused thread/connection) will inherit the label
 * until something overwrites or clears it. **Always pair with a matching
 * `resetAgentVersion()` in a `finally` block**, or prefer
 * `runWithAgentVersion(label, fn)` which guarantees scoped cleanup.
 *
 * @example
 *   try {
 *     setAgentVersion('hotfix-2026-05-12');
 *     await runAgent();
 *   } finally {
 *     resetAgentVersion();
 *   }
 *
 * @example
 *   // Preferred — automatic scope cleanup, no leak risk:
 *   await runWithAgentVersion('hotfix-2026-05-12', () => runAgent());
 */
function setAgentVersion(version) {
    if (typeof version !== 'string' || version.length === 0)
        return;
    _currentAgentVersion.enterWith(version);
}
/**
 * Clear the agent version label set by `setAgentVersion()`. No-op if no
 * label is active. See the `setAgentVersion` docstring for the leak
 * scenario this guards against.
 */
function resetAgentVersion() {
    _currentAgentVersion.enterWith(undefined);
}
/**
 * Run `fn` with the given agent version label bound to the current async
 * scope. Mirrors `openlit.agent_version_context()` in Python and is the
 * recommended way to attach a label — the store is automatically restored
 * when `fn` resolves so there is no risk of leaking the label across
 * subsequent requests.
 */
function runWithAgentVersion(version, fn) {
    return _currentAgentVersion.run(version, fn);
}
const _langGraphActive = new async_hooks_1.AsyncLocalStorage();
/**
 * Returns true when a LangGraph wrapper is controlling execution.
 * LangChain's callback handler skips its own invoke_workflow span when true.
 */
function isLangGraphActive() {
    return _langGraphActive.getStore() === true;
}
function runWithLangGraph(fn) {
    return _langGraphActive.run(true, fn);
}
const _createAgentActive = new async_hooks_1.AsyncLocalStorage();
/**
 * Returns true when a create_agent span is already being handled
 * (prevents duplicate spans between LangChain and LangGraph).
 */
function isCreateAgentActive() {
    return _createAgentActive.getStore() === true;
}
function runWithCreateAgent(fn) {
    return _createAgentActive.run(true, fn);
}
const _langGraphConversationId = new async_hooks_1.AsyncLocalStorage();
/**
 * Propagate conversation ID from invoke_workflow to child node spans.
 * Mirrors Python's set_langgraph_conversation_id / get_langgraph_conversation_id.
 */
function getLangGraphConversationId() {
    return _langGraphConversationId.getStore();
}
function runWithLangGraphConversationId(conversationId, fn) {
    return _langGraphConversationId.run(conversationId, fn);
}
// ---------------------------------------------------------------------------
// Framework parent context propagation (mirrors Python context_api.attach)
// ---------------------------------------------------------------------------
const _frameworkParentContext = new async_hooks_1.AsyncLocalStorage();
/**
 * Returns the OTel context set by a framework processor (OpenAI Agents, etc.)
 * so that provider wrappers can create spans as children of framework spans.
 * Mirrors Python's context_api.attach(set_span_in_context(span)).
 */
function getFrameworkParentContext() {
    return _frameworkParentContext.getStore() || undefined;
}
/**
 * Set the OTel parent context for provider span creation.
 * Called by processor-based frameworks that cannot use context.with().
 */
function setFrameworkParentContext(ctx) {
    _frameworkParentContext.enterWith(ctx);
}
/**
 * Clear the framework parent context.
 */
function clearFrameworkParentContext() {
    _frameworkParentContext.enterWith(undefined);
}
// ---------------------------------------------------------------------------
// Provider default endpoints (mirrors Python PROVIDER_DEFAULT_ENDPOINTS)
// ---------------------------------------------------------------------------
const PROVIDER_DEFAULT_ENDPOINTS = {
    openai: ['api.openai.com', 443],
    anthropic: ['api.anthropic.com', 443],
    google: ['generativelanguage.googleapis.com', 443],
    'gcp.gemini': ['generativelanguage.googleapis.com', 443],
    'gcp.vertex_ai': ['aiplatform.googleapis.com', 443],
    mistral_ai: ['api.mistral.ai', 443],
    groq: ['api.groq.com', 443],
    ai21: ['api.ai21.com', 443],
    digitalocean: ['inference.do-ai.run', 443],
    together: ['api.together.xyz', 443],
    fireworks: ['api.fireworks.ai', 443],
    perplexity: ['api.perplexity.ai', 443],
    deepinfra: ['api.deepinfra.com', 443],
    'aws.bedrock': ['bedrock-runtime.amazonaws.com', 443],
    azure: ['openai.azure.com', 443],
    'azure.ai.openai': ['openai.azure.com', 443],
    'azure.ai.inference': ['inference.ai.azure.com', 443],
    cohere: ['api.cohere.ai', 443],
    ollama: ['localhost', 11434],
    deepseek: ['api.deepseek.com', 443],
    x_ai: ['api.x.ai', 443],
    huggingface: ['api-inference.huggingface.co', 443],
    cursor: ['api2.cursor.sh', 443],
};
function getServerAddressForProvider(provider) {
    return PROVIDER_DEFAULT_ENDPOINTS[provider] || ['', 0];
}
/** LangChain/LangGraph message type → OTel GenAI role (mirrors Python LANGCHAIN_ROLE_MAPPING). */
exports.LANGCHAIN_ROLE_MAP = {
    system: 'system',
    human: 'user',
    ai: 'assistant',
    tool: 'tool',
    function: 'tool',
};
exports.OTEL_ASSISTANT_ROLE = exports.LANGCHAIN_ROLE_MAP.ai;
/** Map a raw LangChain message type/role to the OTel GenAI convention value. */
function mapLangChainRole(rawRole) {
    if (!rawRole) {
        return exports.OTEL_ASSISTANT_ROLE;
    }
    return exports.LANGCHAIN_ROLE_MAP[rawRole] ?? rawRole;
}
/**
 * Apply global (from init) and context-scoped (from usingAttributes /
 * injectAdditionalAttributes) custom attributes to a span.
 * Global attributes are applied first; context attributes override on conflict.
 * Matches Python's _apply_custom_span_attributes().
 */
function applyCustomSpanAttributes(span) {
    const globalAttrs = config_1.default.customSpanAttributes;
    if (globalAttrs) {
        for (const [key, value] of Object.entries(globalAttrs)) {
            span.setAttribute(key, value);
        }
    }
    const contextAttrs = _customSpanAttributes.getStore();
    if (contextAttrs) {
        for (const [key, value] of Object.entries(contextAttrs)) {
            span.setAttribute(key, value);
        }
    }
}
/**
 * Get merged custom attributes (global + context) for use in events.
 * Returns a flat object; context attributes override global on conflict.
 */
function getMergedCustomAttributes() {
    const merged = {};
    const globalAttrs = config_1.default.customSpanAttributes;
    if (globalAttrs) {
        Object.assign(merged, globalAttrs);
    }
    const contextAttrs = _customSpanAttributes.getStore();
    if (contextAttrs) {
        Object.assign(merged, contextAttrs);
    }
    return merged;
}
/**
 * Run a function with custom span attributes attached to all
 * auto-instrumented spans created during its execution.
 * Matches Python's openlit.inject_additional_attributes().
 */
function injectAdditionalAttributes(fn, attributes) {
    return _customSpanAttributes.run(attributes, fn);
}
/**
 * Context wrapper that adds custom attributes to all auto-instrumented
 * spans created within its callback scope.
 * Matches Python's openlit.using_attributes() context manager.
 *
 * Usage:
 *   await usingAttributes({"user.id": "u1", "team": "ml"}, async () => {
 *     await client.chat.completions.create(...);
 *   });
 */
function usingAttributes(attributes, fn) {
    return _customSpanAttributes.run(attributes, fn);
}
class OpenLitHelper {
    static openaiTokens(text, model) {
        try {
            const encoding = (0, js_tiktoken_1.encodingForModel)(model);
            return encoding.encode(text).length;
        }
        catch {
            return OpenLitHelper.generalTokens(text);
        }
    }
    static generalTokens(text) {
        const encoding = (0, js_tiktoken_1.encodingForModel)('gpt2');
        return encoding.encode(text).length;
    }
    /**
     * Compute chat completion cost, optionally accounting for prompt-cache tokens.
     *
     * When the model's pricing entry defines `cacheReadPrice` / `cacheCreationPrice`,
     * the matching cache tokens are billed at those rates instead of the regular
     * prompt price.
     *
     * Token accounting differs across providers:
     *   - Anthropic's native API reports `promptTokens` exclusive of cache tokens,
     *     so cache tokens are added on top (keep `promptTokensIncludeCache` false).
     *   - OpenAI / LangChain report `promptTokens` inclusive of cache read tokens,
     *     so pass `promptTokensIncludeCache: true` to subtract the re-priced cache
     *     tokens from the prompt base and avoid billing them twice.
     *
     * Cache tokens are only re-priced (and, when inclusive, only subtracted) when a
     * dedicated cache price exists, so the result is identical to the legacy
     * behaviour for any model without cache pricing configured.
     */
    static getChatModelCost(model, pricingInfo, promptTokens, completionTokens, cacheReadTokens = 0, cacheCreationTokens = 0, promptTokensIncludeCache = false) {
        try {
            const chatPricing = pricingInfo?.chat;
            if (!chatPricing)
                return 0;
            let modelPricing = chatPricing[model];
            if (modelPricing == null && model.includes('/')) {
                modelPricing = chatPricing[model.split('/', 2)[1]];
            }
            if (modelPricing == null)
                return 0;
            const cacheRead = cacheReadTokens || 0;
            const cacheCreation = cacheCreationTokens || 0;
            let billablePromptTokens = promptTokens;
            let cacheCost = 0;
            if (modelPricing.cacheReadPrice != null) {
                cacheCost += (cacheRead / OpenLitHelper.PROMPT_TOKEN_FACTOR) * modelPricing.cacheReadPrice;
                if (promptTokensIncludeCache) {
                    billablePromptTokens -= cacheRead;
                }
            }
            if (modelPricing.cacheCreationPrice != null) {
                cacheCost +=
                    (cacheCreation / OpenLitHelper.PROMPT_TOKEN_FACTOR) * modelPricing.cacheCreationPrice;
                if (promptTokensIncludeCache) {
                    billablePromptTokens -= cacheCreation;
                }
            }
            if (billablePromptTokens < 0) {
                billablePromptTokens = 0;
            }
            const cost = (billablePromptTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) * modelPricing.promptPrice +
                (completionTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) * modelPricing.completionPrice +
                cacheCost;
            return isNaN(cost) ? 0 : cost;
        }
        catch {
            return 0;
        }
    }
    static getEmbedModelCost(model, pricingInfo, promptTokens) {
        try {
            const embedPricing = pricingInfo?.embeddings;
            if (!embedPricing)
                return 0;
            let unitCost = embedPricing[model];
            if (unitCost == null && model.includes('/')) {
                unitCost = embedPricing[model.split('/', 2)[1]];
            }
            if (unitCost == null)
                return 0;
            const cost = (promptTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) * unitCost;
            return isNaN(cost) ? 0 : cost;
        }
        catch {
            return 0;
        }
    }
    static getImageModelCost(model, pricingInfo, size, quality) {
        try {
            const cost = pricingInfo.images[model][quality][size];
            return isNaN(cost) ? 0 : cost;
        }
        catch (error) {
            console.error(`Error in getImageModelCost: ${error}`);
            return 0;
        }
    }
    static getAudioModelCost(model, pricingInfo, prompt) {
        try {
            const cost = (prompt.length / OpenLitHelper.PROMPT_TOKEN_FACTOR) * pricingInfo.audio[model];
            return isNaN(cost) ? 0 : cost;
        }
        catch (error) {
            console.error(`Error in getAudioModelCost: ${error}`);
            return 0;
        }
    }
    static async fetchPricingInfo(pricingJson) {
        let pricingUrl = 'https://raw.githubusercontent.com/openlit/openlit/main/assets/pricing.json';
        if (pricingJson) {
            let isUrl = false;
            try {
                isUrl = !!new URL(pricingJson);
            }
            catch {
                isUrl = false;
            }
            if (isUrl) {
                pricingUrl = pricingJson;
            }
            else {
                try {
                    if (typeof pricingJson === 'string') {
                        const json = JSON.parse(pricingJson);
                        return json;
                    }
                    else {
                        const json = JSON.parse(JSON.stringify(pricingJson));
                        return json;
                    }
                }
                catch {
                    return {};
                }
            }
        }
        try {
            const response = await fetch(pricingUrl);
            if (response.ok) {
                return response.json();
            }
            else {
                throw new Error(`HTTP error occurred while fetching pricing info: ${response.status}`);
            }
        }
        catch (error) {
            console.error(`Unexpected error occurred while fetching pricing info: ${error}`);
            return {};
        }
    }
    /**
     * Build OTel-spec input messages JSON string from provider messages array.
     * Format: [{"role": "user", "parts": [{"type": "text", "content": "..."}]}]
     */
    static buildInputMessages(messages, system) {
        try {
            const otelMessages = [];
            if (system) {
                otelMessages.push({ role: 'system', parts: [{ type: 'text', content: system }] });
            }
            for (const msg of messages || []) {
                const role = msg.role || 'user';
                const content = msg.content;
                const parts = [];
                if (typeof content === 'string' && content) {
                    parts.push({ type: 'text', content });
                }
                else if (Array.isArray(content)) {
                    for (const item of content) {
                        const t = item.type;
                        if (t === 'text') {
                            parts.push({ type: 'text', content: item.text || '' });
                        }
                        else if (t === 'image_url') {
                            const url = item.image_url?.url || '';
                            if (url && !url.startsWith('data:')) {
                                parts.push({ type: 'uri', modality: 'image', uri: url });
                            }
                        }
                        else if (t === 'image') {
                            // Anthropic image format
                            const url = item.source?.url || '';
                            if (url && !url.startsWith('data:')) {
                                parts.push({ type: 'uri', modality: 'image', uri: url });
                            }
                        }
                        else if (t === 'tool_use') {
                            parts.push({ type: 'tool_call', id: item.id || '', name: item.name || '', arguments: item.input || {} });
                        }
                        else if (t === 'tool_result') {
                            parts.push({ type: 'tool_call_response', id: item.tool_use_id || '', response: typeof item.content === 'string' ? item.content : JSON.stringify(item.content || '') });
                        }
                    }
                }
                // Handle tool_calls in message (OpenAI assistant format)
                if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                    for (const tc of msg.tool_calls) {
                        let args = tc.function?.arguments || {};
                        if (typeof args === 'string') {
                            try {
                                args = JSON.parse(args);
                            }
                            catch {
                                args = { raw: args };
                            }
                        }
                        parts.push({ type: 'tool_call', id: tc.id || '', name: tc.function?.name || '', arguments: args });
                    }
                }
                if (parts.length > 0) {
                    otelMessages.push({ role, parts });
                }
            }
            return JSON.stringify(otelMessages);
        }
        catch {
            return '[]';
        }
    }
    /**
     * Extract system message(s) from a chat-completions messages array.
     * Returns an OTel ``gen_ai.system_instructions`` payload
     * (``[{"type": "text", "content": "..."}]``) JSON-encoded as a string,
     * or ``undefined`` when no system message is present.
     *
     * Mirrors Python's ``build_system_instructions_from_messages``.
     */
    static buildSystemInstructionsFromMessages(messages) {
        if (!Array.isArray(messages) || messages.length === 0)
            return undefined;
        try {
            const instructions = [];
            for (const msg of messages) {
                if (!msg || msg.role !== 'system')
                    continue;
                const content = msg.content;
                if (Array.isArray(content)) {
                    for (const part of content) {
                        if (part && part.type === 'text' && part.text) {
                            instructions.push({ type: 'text', content: String(part.text) });
                        }
                        else if (typeof part === 'string' && part) {
                            instructions.push({ type: 'text', content: part });
                        }
                    }
                }
                else if (content) {
                    instructions.push({ type: 'text', content: String(content) });
                }
            }
            if (instructions.length === 0)
                return undefined;
            return JSON.stringify(instructions);
        }
        catch {
            return undefined;
        }
    }
    /**
     * Normalize a request ``tools`` array into the OTel
     * ``gen_ai.tool.definitions`` schema and return it as a JSON string,
     * or ``undefined`` when there is nothing usable.
     *
     * Accepts both the OpenAI-style schema
     * (``{"type": "function", "function": {...}}``) and the flat schema
     * (``{"name": ..., "description": ..., "parameters": ...}``), and
     * Anthropic's ``input_schema`` synonym for ``parameters``.
     *
     * Mirrors Python's ``build_tool_definitions``.
     */
    static buildToolDefinitions(tools) {
        if (!tools)
            return undefined;
        const list = Array.isArray(tools) ? tools : [];
        if (list.length === 0)
            return undefined;
        try {
            const definitions = [];
            for (const tool of list) {
                if (!tool || typeof tool !== 'object')
                    continue;
                try {
                    if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
                        const fn = tool.function;
                        const name = fn.name ?? '';
                        if (!name)
                            continue;
                        definitions.push({
                            type: 'function',
                            name,
                            description: fn.description ?? '',
                            parameters: fn.parameters ?? {},
                        });
                        continue;
                    }
                    if (tool.name) {
                        definitions.push({
                            type: 'function',
                            name: tool.name,
                            description: tool.description ?? '',
                            parameters: tool.parameters ?? tool.input_schema ?? {},
                        });
                    }
                }
                catch {
                    continue;
                }
            }
            if (definitions.length === 0)
                return undefined;
            return JSON.stringify(definitions);
        }
        catch {
            return undefined;
        }
    }
    /**
     * Compute the canonical agent-version fingerprint.
     *
     * Mirrors `fingerprint()` in
     * `src/client/src/lib/platform/agents/snapshot.ts` so that the SDK stamps
     * `openlit.agent.version_hash` with the same value the server-side
     * materializer derives from `otel_traces`. The hash covers the parts that
     * meaningfully change agent behavior: system prompt, tool set (name +
     * schema), primary model, and sampling config.
     *
     * Accepts the same shapes used by the SDK chat finalizers:
     *  - `systemInstructions`: the JSON string emitted on
     *    `gen_ai.system_instructions`, the original list of `{type,content}`
     *    parts, or a plain string.
     *  - `toolDefinitions`: the JSON string emitted on
     *    `gen_ai.tool.definitions`, or the original list of
     *    `{type, name, description, parameters}` items.
     */
    static computeAgentVersionHash(args) {
        // This runs on every chat/llm span on the hot path. The hashing code
        // touches user-supplied payloads (tool schemas, runtime configs) and a
        // single odd value historically blew up the whole span. Return '' on
        // any failure so the wrapper falls back to time-window matching and the
        // span still gets exported. Mirrors the Python SDK's defensive
        // try/except in `compute_agent_version_hash`.
        // Process-local LRU memoization. Provider wrappers re-invoke this with
        // identical inputs on every LLM request for the same agent; the cache
        // key uses cheap string coercion so building it is far cheaper than the
        // canonical JSON serialization + SHA1 work we'd otherwise repeat.
        const cacheKey = OpenLitHelper._buildAgentVersionCacheKey(args);
        if (cacheKey) {
            const cached = OpenLitHelper._versionHashCache.get(cacheKey);
            if (cached !== undefined) {
                // Re-insert to bump recency in JS Map (insertion-order eviction).
                OpenLitHelper._versionHashCache.delete(cacheKey);
                OpenLitHelper._versionHashCache.set(cacheKey, cached);
                return cached;
            }
        }
        try {
            const normalizeWhitespace = (s) => (s || '').replace(/\s+/g, ' ').trim();
            const canonical = (value) => {
                if (Array.isArray(value))
                    return value.map(canonical);
                if (value && typeof value === 'object') {
                    const sorted = {};
                    for (const k of Object.keys(value).sort()) {
                        sorted[k] = canonical(value[k]);
                    }
                    return sorted;
                }
                return value;
            };
            const roundTo3 = (v) => {
                if (v === undefined || v === null)
                    return null;
                const n = typeof v === 'number' ? v : Number(v);
                if (!Number.isFinite(n))
                    return null;
                return Math.round(n * 1000) / 1000;
            };
            const coerceMaxTokens = (v) => {
                if (v === undefined || v === null)
                    return null;
                const n = typeof v === 'number' ? v : Number(v);
                if (!Number.isFinite(n))
                    return null;
                return Math.trunc(n);
            };
            const sp = (() => {
                const raw = args.systemInstructions;
                if (raw == null)
                    return '';
                if (typeof raw === 'string')
                    return raw;
                try {
                    return JSON.stringify(raw);
                }
                catch {
                    return '';
                }
            })();
            const parsedTools = (() => {
                const raw = args.toolDefinitions;
                if (raw == null)
                    return [];
                if (typeof raw === 'string') {
                    try {
                        const parsed = JSON.parse(raw);
                        return Array.isArray(parsed) ? parsed : [];
                    }
                    catch {
                        return [];
                    }
                }
                return Array.isArray(raw) ? raw : [];
            })();
            const tools = parsedTools
                .map((t) => {
                if (!t || typeof t !== 'object')
                    return null;
                const rec = t;
                const name = typeof rec.name === 'string' ? rec.name : '';
                if (!name)
                    return null;
                const schema = rec.parameters !== undefined
                    ? rec.parameters
                    : rec.input_schema !== undefined
                        ? rec.input_schema
                        : rec.schema !== undefined
                            ? rec.schema
                            : null;
                return { n: name, s: canonical(schema) };
            })
                .filter((t) => t !== null)
                // Byte-order (codepoint) sort to stay deterministic across locales
                // and to match the Python SDK's default `tools.sort(key=lambda t: t["n"])`,
                // which also sorts by Unicode codepoint. `localeCompare` is locale-
                // dependent and would diverge from the server fingerprint for
                // non-ASCII tool names.
                .sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
            const providersSorted = [...(args.providers || [])].filter(Boolean).sort();
            const rc = args.runtimeConfig || {};
            const payload = canonical({
                sp: normalizeWhitespace(sp),
                tools,
                model: args.primaryModel || '',
                cfg: {
                    temperature: roundTo3(rc.temperature ?? null),
                    top_p: roundTo3(rc.top_p ?? null),
                    max_tokens: coerceMaxTokens(rc.max_tokens ?? null),
                    provider: rc.provider || providersSorted[0] || '',
                },
            });
            const result = (0, crypto_1.createHash)('sha1')
                .update(JSON.stringify(payload))
                .digest('hex')
                .slice(0, 16);
            if (cacheKey) {
                OpenLitHelper._versionHashCache.set(cacheKey, result);
                if (OpenLitHelper._versionHashCache.size > OpenLitHelper._VERSION_HASH_CACHE_MAX) {
                    const firstKey = OpenLitHelper._versionHashCache.keys().next().value;
                    if (firstKey !== undefined)
                        OpenLitHelper._versionHashCache.delete(firstKey);
                }
            }
            return result;
        }
        catch {
            return '';
        }
    }
    /**
     * Build a stable, cheap cache key for the version-hash memoization. Uses
     * `JSON.stringify` of inputs (orders-of-magnitude cheaper than the full
     * canonical pass we want to skip on a cache hit). Returns `null` if
     * inputs can't be stringified (circular refs etc.) — the caller falls
     * back to uncached computation.
     */
    static _buildAgentVersionCacheKey(args) {
        try {
            const si = typeof args.systemInstructions === 'string' || args.systemInstructions == null
                ? args.systemInstructions ?? ''
                : JSON.stringify(args.systemInstructions);
            const td = typeof args.toolDefinitions === 'string' || args.toolDefinitions == null
                ? args.toolDefinitions ?? ''
                : JSON.stringify(args.toolDefinitions);
            const rc = args.runtimeConfig ? JSON.stringify(args.runtimeConfig) : '';
            const prov = [...(args.providers || [])]
                .filter(Boolean)
                .sort()
                .join(',');
            return `${si}|${td}|${args.primaryModel || ''}|${rc}|${prov}`;
        }
        catch {
            return null;
        }
    }
    /**
     * Build OTel-spec output messages JSON string from provider response.
     * Format: [{"role": "assistant", "parts": [{"type": "text", "content": "..."}], "finish_reason": "stop"}]
     */
    static buildOutputMessages(text, finishReason, toolCalls) {
        try {
            const parts = [];
            if (text) {
                parts.push({ type: 'text', content: text });
            }
            if (toolCalls && toolCalls.length > 0) {
                for (const tc of toolCalls) {
                    let args = tc.function?.arguments || tc.arguments || {};
                    if (typeof args === 'string') {
                        try {
                            args = JSON.parse(args);
                        }
                        catch {
                            args = { raw: args };
                        }
                    }
                    parts.push({
                        type: 'tool_call',
                        id: tc.id || '',
                        name: tc.function?.name || tc.name || '',
                        arguments: args,
                    });
                }
            }
            return JSON.stringify([{ role: 'assistant', parts, finish_reason: finishReason || 'stop' }]);
        }
        catch {
            return '[]';
        }
    }
    /**
     * Emit an inference event via the LoggerProvider, matching Python SDK's
     * gen_ai.client.inference.operation.details event.
     * Falls back to span.addEvent if LoggerProvider is not available.
     */
    static emitInferenceEvent(span, attrs) {
        const eventAttributes = {};
        const customAttrs = getMergedCustomAttributes();
        for (const [key, value] of Object.entries(customAttrs)) {
            if (value !== undefined && value !== null) {
                eventAttributes[key] = value;
            }
        }
        for (const [key, value] of Object.entries(attrs)) {
            if (value !== undefined && value !== null) {
                eventAttributes[key] = value;
            }
        }
        if (events_1.default.logger) {
            events_1.default.logger.emit({
                eventName: semantic_convention_1.default.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
                context: api_1.trace.setSpan(api_1.context.active(), span),
                severityNumber: api_logs_1.SeverityNumber.INFO,
                severityText: 'INFO',
                body: semantic_convention_1.default.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
                attributes: {
                    ...eventAttributes,
                    'event.name': semantic_convention_1.default.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
                },
            });
        }
        else {
            span.addEvent(semantic_convention_1.default.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS, eventAttributes);
        }
    }
    static handleException(span, error) {
        span.recordException(error);
        span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: error.message });
        const errorType = error.constructor?.name || '_OTHER';
        span.setAttribute(semantic_convention_1.default.ERROR_TYPE, errorType);
    }
    static async createStreamProxy(stream, generatorFuncResponse) {
        return new Proxy(stream, {
            get(target, prop, receiver) {
                if (prop === Symbol.asyncIterator) {
                    return () => generatorFuncResponse;
                }
                return Reflect.get(target, prop, receiver);
            }
        });
    }
}
OpenLitHelper.PROMPT_TOKEN_FACTOR = 1000;
OpenLitHelper._VERSION_HASH_CACHE_MAX = 256;
OpenLitHelper._versionHashCache = new Map();
exports.default = OpenLitHelper;
//# sourceMappingURL=helpers.js.map