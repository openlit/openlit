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
      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, provider);
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
      const toolCalls: Array<{ id: string; type: string; name: string; arguments: unknown }> = [];

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
          // Tool calls — LangChain surfaces these on AIMessage.tool_calls as
          // `{ id, name, args }`. Normalise the field name so helpers.buildOutputMessages
          // (which accepts a toolCalls array) can fold them into gen_ai.output.messages.
          const rawToolCalls =
            msg?.tool_calls ||
            gen?.message?.tool_calls ||
            msg?.additional_kwargs?.tool_calls ||
            [];
          if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
            for (const tc of rawToolCalls) {
              toolCalls.push({
                id: tc.id || tc.tool_call_id || '',
                type: tc.type || 'function',
                name: tc.name || tc.function?.name || '',
                arguments: tc.args ?? tc.arguments ?? tc.function?.arguments ?? {},
              });
            }
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

      if (OpenlitConfig.traceContent && (completionContent || toolCalls.length > 0)) {
        span.setAttribute(
          SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
          OpenLitHelper.buildOutputMessages(
            completionContent,
            finishReason,
            toolCalls.length > 0 ? toolCalls : undefined
          )
        );
      }

      // Flatten tool-call metadata for easier indexing / filtering in backends
      // that don't expand the nested gen_ai.output.messages JSON.
      if (toolCalls.length > 0) {
        const toolNames = toolCalls.map((t) => t.name || '').filter(Boolean);
        const toolIds = toolCalls.map((t) => t.id || '').filter(Boolean);
        const toolArgs = toolCalls.map((t) =>
          typeof t.arguments === 'string' ? t.arguments : JSON.stringify(t.arguments ?? {})
        );
        if (toolNames.length > 0) {
          span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, toolNames.join(', '));
        }
        if (toolIds.length > 0) {
          span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, toolIds.join(', '));
        }
        if (toolArgs.length > 0) {
          span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, toolArgs);
        }
      }

      // base attributes (system, endpoint, etc.)
      BaseWrapper.setBaseSpanAttributes(span, {
        genAIEndpoint: `langchain.chat_model`,
        model: responseModel,
        cost,
        aiSystem: SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
        serverAddress: 'localhost',
        serverPort: 80,
      });

      const metricParams: BaseSpanAttributes = {
        genAIEndpoint: 'langchain.chat_model',
        model: responseModel,
        cost,
        aiSystem: SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
        serverAddress: 'localhost',
        serverPort: 80,
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
      const isAgent = id.some((part: string) => part.toLowerCase().includes('agent')) ||
                      name.toLowerCase().includes('agent');

      const operationType = isAgent
        ? SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
        : SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK;
      const spanName = isAgent ? `invoke_agent ${name}` : `invoke_workflow ${name}`;

      const parentCtx = this._getParentContext(parentRunId);
      const span = this.tracer.startSpan(
        spanName,
        { kind: SpanKind.INTERNAL },
        parentCtx
      );

      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN);
      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN);
      span.setAttribute(SemanticConvention.GEN_AI_OPERATION, operationType);
      span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, OpenlitConfig.environment || '');
      span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, OpenlitConfig.applicationName || '');

      if (isAgent) {
        span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, name);
      } else {
        span.setAttribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, name);
      }

      if (OpenlitConfig.traceContent && inputs) {
        span.setAttribute(SemanticConvention.GEN_AI_WORKFLOW_INPUT, JSON.stringify(inputs).slice(0, 2000));
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
        holder.span.setAttribute(SemanticConvention.GEN_AI_WORKFLOW_OUTPUT, JSON.stringify(outputs).slice(0, 2000));
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

  // ---- Tool callbacks --------------------------------------------------------

  handleToolStart(tool: any, input: string, runId: string, parentRunId?: string) {
    try {
      const id: string[] = tool?.id || [];
      const name = tool?.name || tool?.kwargs?.name || id[id.length - 1] || 'unknown';
      const spanName = `execute_tool ${name}`;

      const parentCtx = this._getParentContext(parentRunId);
      const span = this.tracer.startSpan(
        spanName,
        { kind: SpanKind.INTERNAL },
        parentCtx
      );

      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN);
      span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS);
      span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, OpenlitConfig.environment || '');
      span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, OpenlitConfig.applicationName || '');
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, name);
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_TYPE_OTEL, 'function');

      const description = tool?.description;
      if (description) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_DESCRIPTION, String(description));
      }

      if (OpenlitConfig.traceContent && input) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, String(input).slice(0, 2000));
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

  handleToolEnd(output: any, runId: string) {
    try {
      const holder = this.spans.get(runId);
      if (!holder) return;
      const duration = (Date.now() - holder.startTime) / 1000;
      holder.span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
      if (OpenlitConfig.traceContent && output) {
        holder.span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_RESULT, String(output).slice(0, 2000));
      }
      holder.span.setStatus({ code: 1 });
      holder.span.end();
      this.spans.delete(runId);
    } catch { /* non-blocking */ }
  }

  handleToolError(error: any, runId: string) {
    try {
      const holder = this.spans.get(runId);
      if (!holder) return;
      OpenLitHelper.handleException(holder.span, error);
      holder.span.end();
      this.spans.delete(runId);
    } catch { /* non-blocking */ }
  }

  // ---- Retriever callbacks ---------------------------------------------------

  handleRetrieverStart(retriever: any, query: string, runId: string, parentRunId?: string) {
    try {
      const id: string[] = retriever?.id || [];
      const name = retriever?.name || retriever?.kwargs?.name || id[id.length - 1] || 'unknown';
      const spanName = `retrieval ${name}`;

      const parentCtx = this._getParentContext(parentRunId);
      const span = this.tracer.startSpan(
        spanName,
        { kind: SpanKind.CLIENT },
        parentCtx
      );

      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN);
      span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE);
      span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, OpenlitConfig.environment || '');
      span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, OpenlitConfig.applicationName || '');
      span.setAttribute(SemanticConvention.GEN_AI_DATA_SOURCE_ID, name);

      if (OpenlitConfig.traceContent && query) {
        span.setAttribute(SemanticConvention.GEN_AI_RETRIEVAL_QUERY_TEXT, String(query).slice(0, 2000));
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

  handleRetrieverEnd(documents: any[], runId: string) {
    try {
      const holder = this.spans.get(runId);
      if (!holder) return;
      const duration = (Date.now() - holder.startTime) / 1000;
      holder.span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
      holder.span.setAttribute(SemanticConvention.GEN_AI_RETRIEVAL_DOCUMENT_COUNT, documents?.length || 0);

      if (OpenlitConfig.traceContent && documents?.length > 0) {
        const structured = documents.slice(0, 3).map((doc: any) => {
          const content = doc?.pageContent || doc?.page_content || String(doc);
          const entry: Record<string, string> = { content: content.slice(0, 2000) };
          const meta = doc?.metadata;
          if (meta) {
            const docId = meta.id || meta.source;
            if (docId) entry.id = String(docId);
          }
          return entry;
        });
        holder.span.setAttribute(SemanticConvention.GEN_AI_RETRIEVAL_DOCUMENTS, JSON.stringify(structured));
      }

      holder.span.setStatus({ code: 1 });
      holder.span.end();
      this.spans.delete(runId);
    } catch { /* non-blocking */ }
  }

  handleRetrieverError(error: any, runId: string) {
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
export { OpenLITCallbackHandler };
