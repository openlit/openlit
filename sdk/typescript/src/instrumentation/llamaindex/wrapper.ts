import { SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

class LlamaIndexWrapper extends BaseWrapper {
  static aiSystem = 'llamaindex';

  // ---- Helpers ---------------------------------------------------------------

  private static _extractServerInfo(instance: any): { address: string; port: number } {
    const baseUrl =
      instance?.session?.openai?.baseURL ||
      instance?._client?.baseURL ||
      instance?.clientOptions?.baseURL ||
      instance?.llm?.session?.openai?.baseURL ||
      instance?._llm?.session?.openai?.baseURL ||
      '';
    if (baseUrl) {
      try {
        const url = new URL(baseUrl);
        const port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
        return { address: url.hostname, port };
      } catch { /* ignore */ }
    }
    return { address: 'api.openai.com', port: 443 };
  }

  // ---- LLM patches -----------------------------------------------------------

  static _patchLLMChat(tracer: Tracer): any {
    const genAIEndpoint = 'llamaindex.llm.chat';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          let metricParams: BaseSpanAttributes | undefined;
          const startTime = Date.now();
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            const params = args[0] || {};
            const messages = params.messages || [];
            const modelId = this.model || this.modelName || this.metadata?.model || 'unknown';
            const aiSystem = LlamaIndexWrapper.aiSystem;

            const rawUsage = response?.raw?.usage || response?.usage || {};
            const promptTokens = rawUsage.prompt_tokens || rawUsage.input_tokens || 0;
            const completionTokens = rawUsage.completion_tokens || rawUsage.output_tokens || 0;
            const totalTokens = rawUsage.total_tokens || promptTokens + completionTokens;
            const finishReason = response?.raw?.choices?.[0]?.finish_reason || 'stop';

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
            const cost = OpenLitHelper.getChatModelCost(modelId, pricingInfo, promptTokens, completionTokens);

            const { address, port } = LlamaIndexWrapper._extractServerInfo(this);

            LlamaIndexWrapper.setBaseSpanAttributes(span, { genAIEndpoint, model: modelId, cost, aiSystem, serverAddress: address, serverPort: port });

            span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, modelId);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);
            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, totalTokens);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
            span.setAttribute(SemanticConvention.SERVER_ADDRESS, address);
            span.setAttribute(SemanticConvention.SERVER_PORT, port);

            if (OpenlitConfig.traceContent) {
              const formattedMessages = messages.map((m: any) => ({
                role: m.role || 'user',
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              }));
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(formattedMessages));

              const outputContent = response?.message?.content || response?.text || '';
              span.setAttribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                OpenLitHelper.buildOutputMessages(outputContent, finishReason)
              );
            }

            metricParams = { genAIEndpoint, model: modelId, cost, aiSystem };
            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            throw e;
          } finally {
            span.end();
            if (metricParams) BaseWrapper.recordMetrics(span, metricParams);
          }
        });
      };
    };
  }

  static _patchLLMComplete(tracer: Tracer): any {
    const genAIEndpoint = 'llamaindex.llm.complete';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          let metricParams: BaseSpanAttributes | undefined;
          const startTime = Date.now();
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            const prompt = typeof args[0] === 'string' ? args[0] : args[0]?.prompt || '';
            const modelId = this.model || this.modelName || this.metadata?.model || 'unknown';
            const aiSystem = LlamaIndexWrapper.aiSystem;

            const rawUsage = response?.raw?.usage || response?.usage || {};
            const promptTokens = rawUsage.prompt_tokens || rawUsage.input_tokens || 0;
            const completionTokens = rawUsage.completion_tokens || rawUsage.output_tokens || 0;
            const totalTokens = rawUsage.total_tokens || promptTokens + completionTokens;
            const finishReason = response?.raw?.choices?.[0]?.finish_reason || 'stop';

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
            const cost = OpenLitHelper.getChatModelCost(modelId, pricingInfo, promptTokens, completionTokens);

            const { address, port } = LlamaIndexWrapper._extractServerInfo(this);

            LlamaIndexWrapper.setBaseSpanAttributes(span, { genAIEndpoint, model: modelId, cost, aiSystem, serverAddress: address, serverPort: port });

            span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, modelId);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);
            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, totalTokens);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
            span.setAttribute(SemanticConvention.SERVER_ADDRESS, address);
            span.setAttribute(SemanticConvention.SERVER_PORT, port);

            if (OpenlitConfig.traceContent) {
              span.setAttribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES,
                OpenLitHelper.buildInputMessages([{ role: 'user', content: prompt }])
              );
              const outputContent = response?.text || '';
              span.setAttribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                OpenLitHelper.buildOutputMessages(outputContent, finishReason)
              );
            }

            metricParams = { genAIEndpoint, model: modelId, cost, aiSystem };
            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            throw e;
          } finally {
            span.end();
            if (metricParams) BaseWrapper.recordMetrics(span, metricParams);
          }
        });
      };
    };
  }

  // ---- Query engine patch ----------------------------------------------------

  static _patchQueryEngineQuery(tracer: Tracer): any {
    const genAIEndpoint = 'llamaindex.query_engine.query';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          let metricParams: BaseSpanAttributes | undefined;
          const startTime = Date.now();
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            const queryStr = typeof args[0] === 'string' ? args[0] : args[0]?.query || '';

            const llm = this.llm || this._llm;
            const modelId = llm?.model || llm?.modelName || llm?.metadata?.model || 'unknown';
            const aiSystem = LlamaIndexWrapper.aiSystem;

            const { address, port } = LlamaIndexWrapper._extractServerInfo(llm || this);

            LlamaIndexWrapper.setBaseSpanAttributes(span, { genAIEndpoint, model: modelId, aiSystem, serverAddress: address, serverPort: port });

            span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
            span.setAttribute(SemanticConvention.SERVER_ADDRESS, address);
            span.setAttribute(SemanticConvention.SERVER_PORT, port);

            const sourceNodes = response.sourceNodes || response.source_nodes || [];
            if (sourceNodes.length > 0) {
              span.setAttribute(SemanticConvention.GEN_AI_RETRIEVAL_SOURCE, JSON.stringify(
                sourceNodes.slice(0, 5).map((n: any) => ({
                  id: n.node?.id_ || n.id_ || '',
                  score: n.score,
                  text: n.node?.text?.slice(0, 200) || '',
                }))
              ));
            }

            if (OpenlitConfig.traceContent) {
              span.setAttribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES,
                OpenLitHelper.buildInputMessages([{ role: 'user', content: queryStr }])
              );
              const responseText = typeof response.response === 'string'
                ? response.response
                : response.toString?.() || '';
              span.setAttribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                OpenLitHelper.buildOutputMessages(responseText, 'stop')
              );
            }

            metricParams = { genAIEndpoint, model: modelId, aiSystem };
            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            throw e;
          } finally {
            span.end();
            if (metricParams) BaseWrapper.recordMetrics(span, metricParams);
          }
        });
      };
    };
  }

  // ---- Chat engine patch -----------------------------------------------------

  static _patchChatEngineChat(tracer: Tracer): any {
    const genAIEndpoint = 'llamaindex.chat_engine.chat';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          let metricParams: BaseSpanAttributes | undefined;
          const startTime = Date.now();
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            const messageInput = args[0];
            const message = typeof messageInput === 'string'
              ? messageInput
              : messageInput?.message || messageInput?.content || '';

            const llm = this.llm || this._llm;
            const modelId = llm?.model || llm?.modelName || llm?.metadata?.model || 'unknown';
            const aiSystem = LlamaIndexWrapper.aiSystem;

            const { address, port } = LlamaIndexWrapper._extractServerInfo(llm || this);

            LlamaIndexWrapper.setBaseSpanAttributes(span, { genAIEndpoint, model: modelId, aiSystem, serverAddress: address, serverPort: port });

            span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
            span.setAttribute(SemanticConvention.SERVER_ADDRESS, address);
            span.setAttribute(SemanticConvention.SERVER_PORT, port);

            if (OpenlitConfig.traceContent) {
              span.setAttribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES,
                OpenLitHelper.buildInputMessages([{ role: 'user', content: message }])
              );

              const responseContent =
                response?.message?.content ||
                (typeof response?.response === 'string' ? response.response : '') ||
                response?.toString?.() || '';
              span.setAttribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                OpenLitHelper.buildOutputMessages(responseContent, 'stop')
              );
            }

            metricParams = { genAIEndpoint, model: modelId, aiSystem };
            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            throw e;
          } finally {
            span.end();
            if (metricParams) BaseWrapper.recordMetrics(span, metricParams);
          }
        });
      };
    };
  }
}

export default LlamaIndexWrapper;
