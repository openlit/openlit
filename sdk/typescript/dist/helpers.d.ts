import { Attributes, Context, Span } from '@opentelemetry/api';
/**
 * Returns true when a framework instrumentor (LangChain, LiteLLM, etc.)
 * owns the current LLM span. Provider-level wrappers (OpenAI, Anthropic, …)
 * must skip their own span creation when this returns true.
 */
export declare function isFrameworkLlmActive(): boolean;
/**
 * Run `fn` with the framework-LLM-active flag set. All provider wrappers
 * invoked inside `fn` will see `isFrameworkLlmActive() === true`.
 */
export declare function runWithFrameworkLlm<T>(fn: () => T): T;
/**
 * Set framework-LLM-active flag in the current execution context.
 * Used by SpanProcessor-based instrumentations (Strands) where
 * the processor observes spans rather than controlling execution.
 * Mirrors Python's ContextVar.set(True) in Strands processor.
 */
export declare function setFrameworkLlmActive(): void;
/**
 * Reset framework-LLM-active flag in the current execution context.
 * Mirrors Python's ContextVar.reset(token) in Strands processor.
 */
export declare function resetFrameworkLlmActive(): void;
/**
 * Returns the user-supplied agent version label set via
 * `OpenLit.setAgentVersion()` / `runWithAgentVersion()`, if any.
 *
 * Provider wrappers stamp this on `gen_ai.agent.version` so the server-side
 * materializer can group traces by the user's preferred label in addition to
 * the auto-computed `openlit.agent.version_hash` fingerprint.
 */
export declare function getCurrentAgentVersion(): string | undefined;
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
export declare function setAgentVersion(version: string): void;
/**
 * Clear the agent version label set by `setAgentVersion()`. No-op if no
 * label is active. See the `setAgentVersion` docstring for the leak
 * scenario this guards against.
 */
export declare function resetAgentVersion(): void;
/**
 * Run `fn` with the given agent version label bound to the current async
 * scope. Mirrors `openlit.agent_version_context()` in Python and is the
 * recommended way to attach a label — the store is automatically restored
 * when `fn` resolves so there is no risk of leaking the label across
 * subsequent requests.
 */
export declare function runWithAgentVersion<T>(version: string, fn: () => T): T;
/**
 * Returns true when a LangGraph wrapper is controlling execution.
 * LangChain's callback handler skips its own invoke_workflow span when true.
 */
export declare function isLangGraphActive(): boolean;
export declare function runWithLangGraph<T>(fn: () => T): T;
/**
 * Returns true when a create_agent span is already being handled
 * (prevents duplicate spans between LangChain and LangGraph).
 */
export declare function isCreateAgentActive(): boolean;
export declare function runWithCreateAgent<T>(fn: () => T): T;
/**
 * Propagate conversation ID from invoke_workflow to child node spans.
 * Mirrors Python's set_langgraph_conversation_id / get_langgraph_conversation_id.
 */
export declare function getLangGraphConversationId(): string | undefined;
export declare function runWithLangGraphConversationId<T>(conversationId: string, fn: () => T): T;
/**
 * Returns the OTel context set by a framework processor (OpenAI Agents, etc.)
 * so that provider wrappers can create spans as children of framework spans.
 * Mirrors Python's context_api.attach(set_span_in_context(span)).
 */
export declare function getFrameworkParentContext(): Context | undefined;
/**
 * Set the OTel parent context for provider span creation.
 * Called by processor-based frameworks that cannot use context.with().
 */
export declare function setFrameworkParentContext(ctx: Context): void;
/**
 * Clear the framework parent context.
 */
export declare function clearFrameworkParentContext(): void;
export declare function getServerAddressForProvider(provider: string): [string, number];
/** LangChain/LangGraph message type → OTel GenAI role (mirrors Python LANGCHAIN_ROLE_MAPPING). */
export declare const LANGCHAIN_ROLE_MAP: Record<string, string>;
export declare const OTEL_ASSISTANT_ROLE: string;
/** Map a raw LangChain message type/role to the OTel GenAI convention value. */
export declare function mapLangChainRole(rawRole: string | undefined | null): string;
/**
 * Apply global (from init) and context-scoped (from usingAttributes /
 * injectAdditionalAttributes) custom attributes to a span.
 * Global attributes are applied first; context attributes override on conflict.
 * Matches Python's _apply_custom_span_attributes().
 */
export declare function applyCustomSpanAttributes(span: Span): void;
/**
 * Get merged custom attributes (global + context) for use in events.
 * Returns a flat object; context attributes override global on conflict.
 */
export declare function getMergedCustomAttributes(): Record<string, any>;
/**
 * Run a function with custom span attributes attached to all
 * auto-instrumented spans created during its execution.
 * Matches Python's openlit.inject_additional_attributes().
 */
export declare function injectAdditionalAttributes<T>(fn: () => T, attributes: Record<string, any>): T;
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
export declare function usingAttributes<T>(attributes: Record<string, any>, fn: () => T): T;
export default class OpenLitHelper {
    static readonly PROMPT_TOKEN_FACTOR = 1000;
    static openaiTokens(text: string, model: string): number;
    static generalTokens(text: string): number;
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
    static getChatModelCost(model: string, pricingInfo: any, promptTokens: number, completionTokens: number, cacheReadTokens?: number, cacheCreationTokens?: number, promptTokensIncludeCache?: boolean): number;
    static getEmbedModelCost(model: string, pricingInfo: any, promptTokens: number): number;
    static getImageModelCost(model: string, pricingInfo: any, size: string, quality: number): number;
    static getAudioModelCost(model: string, pricingInfo: any, prompt: string): number;
    static fetchPricingInfo(pricingJson: any): Promise<any>;
    /**
     * Build OTel-spec input messages JSON string from provider messages array.
     * Format: [{"role": "user", "parts": [{"type": "text", "content": "..."}]}]
     */
    static buildInputMessages(messages: any[], system?: string): string;
    /**
     * Extract system message(s) from a chat-completions messages array.
     * Returns an OTel ``gen_ai.system_instructions`` payload
     * (``[{"type": "text", "content": "..."}]``) JSON-encoded as a string,
     * or ``undefined`` when no system message is present.
     *
     * Mirrors Python's ``build_system_instructions_from_messages``.
     */
    static buildSystemInstructionsFromMessages(messages: any[]): string | undefined;
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
    static buildToolDefinitions(tools: any): string | undefined;
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
    static computeAgentVersionHash(args: {
        systemInstructions?: string | unknown[] | null;
        toolDefinitions?: string | unknown[] | null;
        primaryModel?: string | null;
        runtimeConfig?: {
            temperature?: number | null;
            top_p?: number | null;
            max_tokens?: number | null;
            provider?: string | null;
        } | null;
        providers?: string[] | null;
    }): string;
    private static readonly _VERSION_HASH_CACHE_MAX;
    private static _versionHashCache;
    /**
     * Build a stable, cheap cache key for the version-hash memoization. Uses
     * `JSON.stringify` of inputs (orders-of-magnitude cheaper than the full
     * canonical pass we want to skip on a cache hit). Returns `null` if
     * inputs can't be stringified (circular refs etc.) — the caller falls
     * back to uncached computation.
     */
    private static _buildAgentVersionCacheKey;
    /**
     * Build OTel-spec output messages JSON string from provider response.
     * Format: [{"role": "assistant", "parts": [{"type": "text", "content": "..."}], "finish_reason": "stop"}]
     */
    static buildOutputMessages(text: string, finishReason: string, toolCalls?: any[]): string;
    /**
     * Emit an inference event via the LoggerProvider, matching Python SDK's
     * gen_ai.client.inference.operation.details event.
     * Falls back to span.addEvent if LoggerProvider is not available.
     */
    static emitInferenceEvent(span: Span, attrs: Attributes): void;
    static handleException(span: Span, error: Error): void;
    static createStreamProxy(stream: any, generatorFuncResponse: any): Promise<any>;
}
