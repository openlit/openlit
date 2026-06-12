import { encodingForModel, TiktokenModel } from 'js-tiktoken';
import { createHash } from 'crypto';
import { Attributes, Context, Span, SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { AsyncLocalStorage } from 'async_hooks';
import SemanticConvention from './semantic-convention';
import Events from './otel/events';
import OpenlitConfig from './config';

/**
 * AsyncLocalStorage for context-scoped custom span attributes.
 * Mirrors Python's ContextVar _custom_span_attributes, used by
 * usingAttributes() and injectAdditionalAttributes().
 */
const _customSpanAttributes = new AsyncLocalStorage<Record<string, any>>();

// ---------------------------------------------------------------------------
// Framework LLM span suppression flags (mirrors Python SDK ContextVars)
// ---------------------------------------------------------------------------

const _frameworkLlmActive = new AsyncLocalStorage<boolean>();

/**
 * Returns true when a framework instrumentor (LangChain, LiteLLM, etc.)
 * owns the current LLM span. Provider-level wrappers (OpenAI, Anthropic, …)
 * must skip their own span creation when this returns true.
 */
export function isFrameworkLlmActive(): boolean {
  return _frameworkLlmActive.getStore() === true;
}

/**
 * Run `fn` with the framework-LLM-active flag set. All provider wrappers
 * invoked inside `fn` will see `isFrameworkLlmActive() === true`.
 */
export function runWithFrameworkLlm<T>(fn: () => T): T {
  return _frameworkLlmActive.run(true, fn);
}

/**
 * Set framework-LLM-active flag in the current execution context.
 * Used by SpanProcessor-based instrumentations (Strands) where
 * the processor observes spans rather than controlling execution.
 * Mirrors Python's ContextVar.set(True) in Strands processor.
 */
export function setFrameworkLlmActive(): void {
  _frameworkLlmActive.enterWith(true);
}

/**
 * Reset framework-LLM-active flag in the current execution context.
 * Mirrors Python's ContextVar.reset(token) in Strands processor.
 */
export function resetFrameworkLlmActive(): void {
  _frameworkLlmActive.enterWith(false);
}

// ---------------------------------------------------------------------------
// User-supplied agent version label (mirrors Python's _current_agent_version)
// ---------------------------------------------------------------------------

const _currentAgentVersion = new AsyncLocalStorage<string>();

/**
 * Returns the user-supplied agent version label set via
 * `OpenLit.setAgentVersion()` / `runWithAgentVersion()`, if any.
 *
 * Provider wrappers stamp this on `gen_ai.agent.version` so the server-side
 * materializer can group traces by the user's preferred label in addition to
 * the auto-computed `openlit.agent.version_hash` fingerprint.
 */
export function getCurrentAgentVersion(): string | undefined {
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
export function setAgentVersion(version: string): void {
  if (typeof version !== 'string' || version.length === 0) return;
  _currentAgentVersion.enterWith(version);
}

/**
 * Clear the agent version label set by `setAgentVersion()`. No-op if no
 * label is active. See the `setAgentVersion` docstring for the leak
 * scenario this guards against.
 */
export function resetAgentVersion(): void {
  _currentAgentVersion.enterWith(undefined as unknown as string);
}

/**
 * Run `fn` with the given agent version label bound to the current async
 * scope. Mirrors `openlit.agent_version_context()` in Python and is the
 * recommended way to attach a label — the store is automatically restored
 * when `fn` resolves so there is no risk of leaking the label across
 * subsequent requests.
 */
export function runWithAgentVersion<T>(version: string, fn: () => T): T {
  return _currentAgentVersion.run(version, fn);
}

const _langGraphActive = new AsyncLocalStorage<boolean>();

/**
 * Returns true when a LangGraph wrapper is controlling execution.
 * LangChain's callback handler skips its own invoke_workflow span when true.
 */
export function isLangGraphActive(): boolean {
  return _langGraphActive.getStore() === true;
}

export function runWithLangGraph<T>(fn: () => T): T {
  return _langGraphActive.run(true, fn);
}

const _createAgentActive = new AsyncLocalStorage<boolean>();

/**
 * Returns true when a create_agent span is already being handled
 * (prevents duplicate spans between LangChain and LangGraph).
 */
export function isCreateAgentActive(): boolean {
  return _createAgentActive.getStore() === true;
}

export function runWithCreateAgent<T>(fn: () => T): T {
  return _createAgentActive.run(true, fn);
}

const _langGraphConversationId = new AsyncLocalStorage<string>();

/**
 * Propagate conversation ID from invoke_workflow to child node spans.
 * Mirrors Python's set_langgraph_conversation_id / get_langgraph_conversation_id.
 */
export function getLangGraphConversationId(): string | undefined {
  return _langGraphConversationId.getStore();
}

export function runWithLangGraphConversationId<T>(conversationId: string, fn: () => T): T {
  return _langGraphConversationId.run(conversationId, fn);
}

// ---------------------------------------------------------------------------
// Framework parent context propagation (mirrors Python context_api.attach)
// ---------------------------------------------------------------------------

const _frameworkParentContext = new AsyncLocalStorage<Context>();

/**
 * Returns the OTel context set by a framework processor (OpenAI Agents, etc.)
 * so that provider wrappers can create spans as children of framework spans.
 * Mirrors Python's context_api.attach(set_span_in_context(span)).
 */
export function getFrameworkParentContext(): Context | undefined {
  return _frameworkParentContext.getStore() || undefined;
}

/**
 * Set the OTel parent context for provider span creation.
 * Called by processor-based frameworks that cannot use context.with().
 */
export function setFrameworkParentContext(ctx: Context): void {
  _frameworkParentContext.enterWith(ctx);
}

/**
 * Clear the framework parent context.
 */
export function clearFrameworkParentContext(): void {
  _frameworkParentContext.enterWith(undefined as any);
}

// ---------------------------------------------------------------------------
// Provider default endpoints (mirrors Python PROVIDER_DEFAULT_ENDPOINTS)
// ---------------------------------------------------------------------------

const PROVIDER_DEFAULT_ENDPOINTS: Record<string, [string, number]> = {
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

export function getServerAddressForProvider(provider: string): [string, number] {
  return PROVIDER_DEFAULT_ENDPOINTS[provider] || ['', 0];
}

/**
 * Apply global (from init) and context-scoped (from usingAttributes /
 * injectAdditionalAttributes) custom attributes to a span.
 * Global attributes are applied first; context attributes override on conflict.
 * Matches Python's _apply_custom_span_attributes().
 */
export function applyCustomSpanAttributes(span: Span): void {
  const globalAttrs = OpenlitConfig.customSpanAttributes;
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
export function getMergedCustomAttributes(): Record<string, any> {
  const merged: Record<string, any> = {};
  const globalAttrs = OpenlitConfig.customSpanAttributes;
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
export function injectAdditionalAttributes<T>(fn: () => T, attributes: Record<string, any>): T {
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
export function usingAttributes<T>(attributes: Record<string, any>, fn: () => T): T {
  return _customSpanAttributes.run(attributes, fn);
}

export default class OpenLitHelper {
  static readonly PROMPT_TOKEN_FACTOR = 1000;

  static openaiTokens(text: string, model: string): number {
    try {
      const encoding = encodingForModel(model as TiktokenModel);
      return encoding.encode(text).length;
    } catch {
      return OpenLitHelper.generalTokens(text);
    }
  }

  static generalTokens(text: string): number {
    const encoding = encodingForModel('gpt2');
    return encoding.encode(text).length;
  }

  static getChatModelCost(
    model: string,
    pricingInfo: any,
    promptTokens: number,
    completionTokens: number
  ): number {
    try {
      const chatPricing = pricingInfo?.chat;
      if (!chatPricing) return 0;
      let modelPricing = chatPricing[model];
      if (modelPricing == null && model.includes('/')) {
        modelPricing = chatPricing[model.split('/', 2)[1]];
      }
      if (modelPricing == null) return 0;
      const cost =
        (promptTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) * modelPricing.promptPrice +
        (completionTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) * modelPricing.completionPrice;
      return isNaN(cost) ? 0 : cost;
    } catch {
      return 0;
    }
  }

  static getEmbedModelCost(model: string, pricingInfo: any, promptTokens: number): number {
    try {
      const embedPricing = pricingInfo?.embeddings;
      if (!embedPricing) return 0;
      let unitCost = embedPricing[model];
      if (unitCost == null && model.includes('/')) {
        unitCost = embedPricing[model.split('/', 2)[1]];
      }
      if (unitCost == null) return 0;
      const cost = (promptTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) * unitCost;
      return isNaN(cost) ? 0 : cost;
    } catch {
      return 0;
    }
  }

  static getImageModelCost(model: string, pricingInfo: any, size: string, quality: number): number {
    try {
      const cost = pricingInfo.images[model][quality][size];
      return isNaN(cost) ? 0 : cost;
    } catch (error) {
      console.error(`Error in getImageModelCost: ${error}`);
      return 0;
    }
  }

  static getAudioModelCost(model: string, pricingInfo: any, prompt: string): number {
    try {
      const cost = (prompt.length / OpenLitHelper.PROMPT_TOKEN_FACTOR) * pricingInfo.audio[model];
      return isNaN(cost) ? 0 : cost;
    } catch (error) {
      console.error(`Error in getAudioModelCost: ${error}`);
      return 0;
    }
  }

  static async fetchPricingInfo(pricingJson: any) {
    let pricingUrl = 'https://raw.githubusercontent.com/openlit/openlit/main/assets/pricing.json';
    if (pricingJson) {
      let isUrl = false;
      try {
        isUrl = !!new URL(pricingJson);
      } catch {
        isUrl = false;
      }

      if (isUrl) {
        pricingUrl = pricingJson;
      } else {
        try {
          if (typeof pricingJson === 'string') {
            const json = JSON.parse(pricingJson);
            return json;
          } else {
            const json = JSON.parse(JSON.stringify(pricingJson));
            return json;
          }
        } catch {
          return {};
        }
      }
    }

    try {
      const response = await fetch(pricingUrl);
      if (response.ok) {
        return response.json();
      } else {
        throw new Error(`HTTP error occurred while fetching pricing info: ${response.status}`);
      }
    } catch (error) {
      console.error(`Unexpected error occurred while fetching pricing info: ${error}`);
      return {};
    }
  }

  /**
   * Build OTel-spec input messages JSON string from provider messages array.
   * Format: [{"role": "user", "parts": [{"type": "text", "content": "..."}]}]
   */
  static buildInputMessages(messages: any[], system?: string): string {
    try {
      const otelMessages: any[] = [];

      if (system) {
        otelMessages.push({ role: 'system', parts: [{ type: 'text', content: system }] });
      }

      for (const msg of messages || []) {
        const role = msg.role || 'user';
        const content = msg.content;
        const parts: any[] = [];

        if (typeof content === 'string' && content) {
          parts.push({ type: 'text', content });
        } else if (Array.isArray(content)) {
          for (const item of content) {
            const t = item.type;
            if (t === 'text') {
              parts.push({ type: 'text', content: item.text || '' });
            } else if (t === 'image_url') {
              const url = item.image_url?.url || '';
              if (url && !url.startsWith('data:')) {
                parts.push({ type: 'uri', modality: 'image', uri: url });
              }
            } else if (t === 'image') {
              // Anthropic image format
              const url = item.source?.url || '';
              if (url && !url.startsWith('data:')) {
                parts.push({ type: 'uri', modality: 'image', uri: url });
              }
            } else if (t === 'tool_use') {
              parts.push({ type: 'tool_call', id: item.id || '', name: item.name || '', arguments: item.input || {} });
            } else if (t === 'tool_result') {
              parts.push({ type: 'tool_call_response', id: item.tool_use_id || '', response: typeof item.content === 'string' ? item.content : JSON.stringify(item.content || '') });
            }
          }
        }

        // Handle tool_calls in message (OpenAI assistant format)
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            let args = tc.function?.arguments || {};
            if (typeof args === 'string') {
              try { args = JSON.parse(args); } catch { args = { raw: args }; }
            }
            parts.push({ type: 'tool_call', id: tc.id || '', name: tc.function?.name || '', arguments: args });
          }
        }

        if (parts.length > 0) {
          otelMessages.push({ role, parts });
        }
      }

      return JSON.stringify(otelMessages);
    } catch {
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
  static buildSystemInstructionsFromMessages(messages: any[]): string | undefined {
    if (!Array.isArray(messages) || messages.length === 0) return undefined;
    try {
      const instructions: { type: 'text'; content: string }[] = [];
      for (const msg of messages) {
        if (!msg || msg.role !== 'system') continue;
        const content = msg.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part && part.type === 'text' && part.text) {
              instructions.push({ type: 'text', content: String(part.text) });
            } else if (typeof part === 'string' && part) {
              instructions.push({ type: 'text', content: part });
            }
          }
        } else if (content) {
          instructions.push({ type: 'text', content: String(content) });
        }
      }
      if (instructions.length === 0) return undefined;
      return JSON.stringify(instructions);
    } catch {
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
  static buildToolDefinitions(tools: any): string | undefined {
    if (!tools) return undefined;
    const list: any[] = Array.isArray(tools) ? tools : [];
    if (list.length === 0) return undefined;
    try {
      const definitions: any[] = [];
      for (const tool of list) {
        if (!tool || typeof tool !== 'object') continue;
        try {
          if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
            const fn = tool.function as Record<string, any>;
            const name = fn.name ?? '';
            if (!name) continue;
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
        } catch {
          continue;
        }
      }
      if (definitions.length === 0) return undefined;
      return JSON.stringify(definitions);
    } catch {
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
  }): string {
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
      const normalizeWhitespace = (s: string): string =>
        (s || '').replace(/\s+/g, ' ').trim();

      const canonical = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') {
          const sorted: Record<string, unknown> = {};
          for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            sorted[k] = canonical((value as Record<string, unknown>)[k]);
          }
          return sorted;
        }
        return value;
      };

      const roundTo3 = (v: unknown): number | null => {
        if (v === undefined || v === null) return null;
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) return null;
        return Math.round(n * 1000) / 1000;
      };

      const coerceMaxTokens = (v: unknown): number | null => {
        if (v === undefined || v === null) return null;
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) return null;
        return Math.trunc(n);
      };

      const sp = (() => {
        const raw = args.systemInstructions;
        if (raw == null) return '';
        if (typeof raw === 'string') return raw;
        try {
          return JSON.stringify(raw);
        } catch {
          return '';
        }
      })();

      const parsedTools: unknown[] = (() => {
        const raw = args.toolDefinitions;
        if (raw == null) return [];
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }
        return Array.isArray(raw) ? raw : [];
      })();

      const tools = parsedTools
        .map((t) => {
          if (!t || typeof t !== 'object') return null;
          const rec = t as Record<string, unknown>;
          const name = typeof rec.name === 'string' ? rec.name : '';
          if (!name) return null;
          const schema =
            rec.parameters !== undefined
              ? rec.parameters
              : rec.input_schema !== undefined
                ? rec.input_schema
                : rec.schema !== undefined
                  ? rec.schema
                  : null;
          return { n: name, s: canonical(schema) };
        })
        .filter((t): t is { n: string; s: unknown } => t !== null)
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

      const result = createHash('sha1')
        .update(JSON.stringify(payload))
        .digest('hex')
        .slice(0, 16);

      if (cacheKey) {
        OpenLitHelper._versionHashCache.set(cacheKey, result);
        if (OpenLitHelper._versionHashCache.size > OpenLitHelper._VERSION_HASH_CACHE_MAX) {
          const firstKey = OpenLitHelper._versionHashCache.keys().next().value;
          if (firstKey !== undefined) OpenLitHelper._versionHashCache.delete(firstKey);
        }
      }
      return result;
    } catch {
      return '';
    }
  }

  private static readonly _VERSION_HASH_CACHE_MAX = 256;
  private static _versionHashCache: Map<string, string> = new Map();

  /**
   * Build a stable, cheap cache key for the version-hash memoization. Uses
   * `JSON.stringify` of inputs (orders-of-magnitude cheaper than the full
   * canonical pass we want to skip on a cache hit). Returns `null` if
   * inputs can't be stringified (circular refs etc.) — the caller falls
   * back to uncached computation.
   */
  private static _buildAgentVersionCacheKey(args: {
    systemInstructions?: string | unknown[] | null;
    toolDefinitions?: string | unknown[] | null;
    primaryModel?: string | null;
    runtimeConfig?: unknown;
    providers?: string[] | null;
  }): string | null {
    try {
      const si =
        typeof args.systemInstructions === 'string' || args.systemInstructions == null
          ? args.systemInstructions ?? ''
          : JSON.stringify(args.systemInstructions);
      const td =
        typeof args.toolDefinitions === 'string' || args.toolDefinitions == null
          ? args.toolDefinitions ?? ''
          : JSON.stringify(args.toolDefinitions);
      const rc = args.runtimeConfig ? JSON.stringify(args.runtimeConfig) : '';
      const prov = [...(args.providers || [])]
        .filter(Boolean)
        .sort()
        .join(',');
      return `${si}|${td}|${args.primaryModel || ''}|${rc}|${prov}`;
    } catch {
      return null;
    }
  }

  /**
   * Build OTel-spec output messages JSON string from provider response.
   * Format: [{"role": "assistant", "parts": [{"type": "text", "content": "..."}], "finish_reason": "stop"}]
   */
  static buildOutputMessages(text: string, finishReason: string, toolCalls?: any[]): string {
    try {
      const parts: any[] = [];

      if (text) {
        parts.push({ type: 'text', content: text });
      }

      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          let args = tc.function?.arguments || tc.arguments || {};
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { args = { raw: args }; }
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
    } catch {
      return '[]';
    }
  }

  /**
   * Emit an inference event via the LoggerProvider, matching Python SDK's
   * gen_ai.client.inference.operation.details event.
   * Falls back to span.addEvent if LoggerProvider is not available.
   */
  static emitInferenceEvent(
    span: Span,
    attrs: Attributes
  ): void {
    const eventAttributes: Attributes = {};

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

    if (Events.logger) {
      Events.logger.emit({
        eventName: SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
        context: trace.setSpan(otelContext.active(), span),
        severityNumber: SeverityNumber.INFO,
        severityText: 'INFO',
        body: SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
        attributes: {
          ...eventAttributes,
          'event.name': SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
        },
      });
    } else {
      span.addEvent(SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS, eventAttributes);
    }
  }

  static handleException(span: Span, error: Error): void {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    const errorType = error.constructor?.name || '_OTHER';
    span.setAttribute(SemanticConvention.ERROR_TYPE, errorType);
  }

  static async createStreamProxy (stream: any, generatorFuncResponse: any): Promise<any> {
    return new Proxy(stream, {
      get (target, prop, receiver) {
        if (prop === Symbol.asyncIterator) {
          return () => generatorFuncResponse
        }
        return Reflect.get(target, prop, receiver)
      }
    })
  }
}
