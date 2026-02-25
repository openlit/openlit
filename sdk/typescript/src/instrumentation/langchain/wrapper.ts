import { SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

// ----------------------------------------------------------------------------
// Span tracking across async callback events
// ----------------------------------------------------------------------------
interface SpanHolder {
  span: any;
  startTime: number;
  modelName: string;
  parentRunId?: string;
  streamingContent: string[];
  tokenTimestamps: number[];
  firstTokenTime?: number;
  promptTokens: number;
  completionTokens: number;
}

// Singleton handler — injected once into every CallbackManager created
let handlerInstance: OpenLITCallbackHandler | null = null;

class OpenLITCallbackHandler {
  name = 'openlit_callback_handler';
  lc_serializable = false;
  // LangChain checks this to decide if it should be copied to child runs
  awaitHandlers = false;

  private tracer: Tracer;
  private spans = new Map<string, SpanHolder>();

  constructor(tracer: Tracer) {
    this.tracer = tracer;
  }

  // ---- Model name helpers --------------------------------------------------

  private _extractModelName(llm: any): string {
    if (!llm) return 'unknown';
    const id: string[] = llm.id || [];
    const className = id[id.length - 1] || '';

    // Try various well-known invocation_params / kwargs paths
    const kw = llm.kwargs || {};
    const ip = kw.invocation_params || {};

    return (
      ip.model_name || ip.model || ip.model_id ||
      kw.model_name || kw.model || kw.model_id ||
      className || 'unknown'
    );
  }

  private _detectProvider(llm: any): string {
    if (!llm) return SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN;
    const classPath = (llm.id || []).join('.').toLowerCase();
    const providerMap: Record<string, string> = {
      openai: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
      anthropic: SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC,
      bedrock: SemanticConvention.GEN_AI_SYSTEM_AWS_BEDROCK,
      google: SemanticConvention.GEN_AI_SYSTEM_VERTEXAI,
      cohere: SemanticConvention.GEN_AI_SYSTEM_COHERE,
      mistral: SemanticConvention.GEN_AI_SYSTEM_MISTRAL,
    };
    for (const [key, val] of Object.entries(providerMap)) {
      if (classPath.includes(key)) return val;
    }
    return SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN;
  }

  // ---- Parent context -------------------------------------------------------

  private _getParentContext(parentRunId?: string) {
    if (!parentRunId) return undefined;
    const holder = this.spans.get(parentRunId);
    if (!holder) return undefined;
    return trace.setSpan(context.active(), holder.span);
  }

  // ---- LLM callbacks -------------------------------------------------------

  handleChatModelStart(
    llm: any,
    messages: any[][],
    runId: string,
    parentRunId?: string,
    _extraParams?: any,
    _tags?: string[],
    metadata?: any,
    name?: string
  ) {
    try {
      const modelName = this._extractModelName(llm);
      const provider = this._detectProvider(llm);
      const spanName = `chat ${modelName}`;

      const parentCtx = this._getParentContext(parentRunId);
      const span = this.tracer.startSpan(
        spanName,
        { kind: SpanKind.CLIENT },
        parentCtx
      );

      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, provider);
      span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
      span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, OpenlitConfig.environment || '');
      span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, OpenlitConfig.applicationName || '');
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, modelName);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

      // Model parameters from invocation_params
      const ip = llm?.kwargs?.invocation_params || {};
      if (ip.temperature != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, ip.temperature);
      if (ip.max_tokens != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, ip.max_tokens);
      if (ip.top_p != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, ip.top_p);

      if (OpenlitConfig.traceContent && messages?.length > 0) {
        const flatMessages = messages.flat().map((m: any) => ({
          role: m._getType?.() || m.type || m.role || 'user',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }));
        span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(flatMessages));
      }

      this.spans.set(runId, {
        span,
        startTime: Date.now(),
        modelName,
        parentRunId,
        streamingContent: [],
        tokenTimestamps: [],
        promptTokens: 0,
        completionTokens: 0,
      });
    } catch { /* non-blocking */ }
  }

  handleLLMNewToken(token: string, _idx: any, runId: string) {
    try {
      const holder = this.spans.get(runId);
      if (!holder) return;
      const now = Date.now();
      if (!holder.firstTokenTime) holder.firstTokenTime = now;
      holder.tokenTimestamps.push(now);
      if (token) holder.streamingContent.push(token);
      // Mark as streaming
      holder.span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);
    } catch { /* non-blocking */ }
  }

  handleLLMEnd(output: any, runId: string) {
    this._finalizeLLMSpan(runId, output, undefined);
  }

  handleLLMError(error: any, runId: string) {
    try {
      const holder = this.spans.get(runId);
      if (!holder) return;
      OpenLitHelper.handleException(holder.span, error);
      holder.span.end();
      this.spans.delete(runId);
    } catch { /* non-blocking */ }
  }

  private async _finalizeLLMSpan(runId: string, output: any, _error: any) {
    try {
      const holder = this.spans.get(runId);
      if (!holder) return;
      const { span, startTime, modelName, streamingContent, tokenTimestamps, firstTokenTime } = holder;
      const endTime = Date.now();
      const isStreaming = streamingContent.length > 0;

      // Extract tokens from output
      let promptTokens = 0;
      let completionTokens = 0;
      let completionContent = '';
      let finishReason = 'stop';
      let responseModel = modelName;

      if (output?.llm_output) {
        const lu = output.llm_output;
        const tu = lu.token_usage || lu.usage || {};
        promptTokens = tu.prompt_tokens || tu.input_tokens || 0;
        completionTokens = tu.completion_tokens || tu.output_tokens || 0;
        responseModel = lu.model_name || lu.model || modelName;
      }

      const generations = output?.generations || [];
      for (const genList of generations) {
        for (const gen of (Array.isArray(genList) ? genList : [genList])) {
          const msg = gen?.message || gen;
          // From usage_metadata (standard LangChain)
          const um = msg?.usage_metadata;
          if (um) {
            if (!promptTokens) promptTokens = um.input_tokens || um.prompt_tokens || 0;
            if (!completionTokens) completionTokens = um.output_tokens || um.completion_tokens || 0;
          }
          // Content
          const content = gen?.text || msg?.content || '';
          if (content && typeof content === 'string' && content.length > completionContent.length) {
            completionContent = content;
          }
          // Finish reason
          const fr = gen?.generationInfo?.finish_reason || msg?.response_metadata?.finish_reason;
          if (fr) finishReason = fr;
        }
      }

      if (isStreaming) {
        completionContent = streamingContent.join('');
      }

      const totalTokens = promptTokens + completionTokens;
      const duration = (endTime - startTime) / 1000;

      const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
      const cost = OpenLitHelper.getChatModelCost(responseModel, pricingInfo, promptTokens, completionTokens);

      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);
      span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, totalTokens);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, cost);
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
      span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);

      if (isStreaming && firstTokenTime) {
        const ttft = (firstTokenTime - startTime) / 1000;
        span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
        if (tokenTimestamps.length > 1) {
          const diffs = tokenTimestamps.slice(1).map((t, i) => t - tokenTimestamps[i]);
          const tbt = diffs.reduce((a, b) => a + b, 0) / diffs.length / 1000;
          span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
        }
      }

      if (OpenlitConfig.traceContent && completionContent) {
        span.setAttribute(
          SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
          OpenLitHelper.buildOutputMessages(completionContent, finishReason)
        );
      }

      // base attributes (system, endpoint, etc.)
      BaseWrapper.setBaseSpanAttributes(span, {
        genAIEndpoint: `langchain.chat_model`,
        model: responseModel,
        cost,
        aiSystem: SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
      });

      const metricParams: BaseSpanAttributes = {
        genAIEndpoint: 'langchain.chat_model',
        model: responseModel,
        cost,
        aiSystem: SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
      };
      span.setStatus({ code: 1 });
      span.end();
      BaseWrapper.recordMetrics(span, metricParams);
      this.spans.delete(runId);
    } catch { /* non-blocking */ }
  }

  // ---- Chain callbacks -------------------------------------------------------

  handleChainStart(chain: any, inputs: any, runId: string, parentRunId?: string) {
    try {
      const id: string[] = chain?.id || [];
      const name = id[id.length - 1] || 'chain';
      const spanName = `workflow ${name}`;

      const parentCtx = this._getParentContext(parentRunId);
      const span = this.tracer.startSpan(
        spanName,
        { kind: SpanKind.INTERNAL },
        parentCtx
      );

      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN);
      span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK);
      span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, OpenlitConfig.environment || '');
      span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, OpenlitConfig.applicationName || '');

      if (OpenlitConfig.traceContent && inputs) {
        span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, JSON.stringify(inputs).slice(0, 2000));
      }

      this.spans.set(runId, {
        span,
        startTime: Date.now(),
        modelName: name,
        parentRunId,
        streamingContent: [],
        tokenTimestamps: [],
        promptTokens: 0,
        completionTokens: 0,
      });
    } catch { /* non-blocking */ }
  }

  handleChainEnd(outputs: any, runId: string) {
    try {
      const holder = this.spans.get(runId);
      if (!holder) return;
      const duration = (Date.now() - holder.startTime) / 1000;
      holder.span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
      if (OpenlitConfig.traceContent && outputs) {
        holder.span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(outputs).slice(0, 2000));
      }
      holder.span.setStatus({ code: 1 });
      holder.span.end();
      this.spans.delete(runId);
    } catch { /* non-blocking */ }
  }

  handleChainError(error: any, runId: string) {
    try {
      const holder = this.spans.get(runId);
      if (!holder) return;
      OpenLitHelper.handleException(holder.span, error);
      holder.span.end();
      this.spans.delete(runId);
    } catch { /* non-blocking */ }
  }
}

// ----------------------------------------------------------------------------
// Wrapper factory
// ----------------------------------------------------------------------------

class LangChainWrapper extends BaseWrapper {
  static _patchConfigure(tracer: Tracer): any {
    // Ensure singleton handler
    if (!handlerInstance) {
      handlerInstance = new OpenLITCallbackHandler(tracer);
    }
    const handler = handlerInstance;

    return (originalConfigure: (...args: any[]) => any) => {
      return function (
        this: any,
        inheritableHandlers?: any,
        ...rest: any[]
      ) {
        // inheritableHandlers can be:
        //   - undefined  : no handlers passed
        //   - Array      : list of handler objects (chat model calls)
        //   - CallbackManager instance: already-built manager (Runnable/chain calls)
        if (Array.isArray(inheritableHandlers) || !inheritableHandlers) {
          const handlers: any[] = inheritableHandlers ? [...inheritableHandlers] : [];
          if (!handlers.some((h: any) => h?.name === 'openlit_callback_handler')) {
            handlers.unshift(handler);
          }
          return originalConfigure.call(this, handlers, ...rest);
        } else {
          // Existing CallbackManager — add our handler directly
          const cbManager = inheritableHandlers;
          if (cbManager?.handlers && !cbManager.handlers.some((h: any) => h?.name === 'openlit_callback_handler')) {
            cbManager.addHandler(handler, true);
          }
          return originalConfigure.call(this, cbManager, ...rest);
        }
      };
    };
  }
}

export default LangChainWrapper;
