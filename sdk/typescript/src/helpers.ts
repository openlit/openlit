import { encodingForModel, TiktokenModel } from 'js-tiktoken';
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
