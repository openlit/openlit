import { Span, SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

class VercelAIWrapper extends BaseWrapper {
  static aiSystem = 'vercel_ai';

  static _getProviderFromModel(model: any): string {
    if (!model) return VercelAIWrapper.aiSystem;
    const provider = model.provider || '';
    if (provider.startsWith('openai')) return SemanticConvention.GEN_AI_SYSTEM_OPENAI;
    if (provider.startsWith('anthropic')) return SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC;
    if (provider.startsWith('google')) return SemanticConvention.GEN_AI_SYSTEM_VERTEXAI;
    if (provider.startsWith('mistral')) return SemanticConvention.GEN_AI_SYSTEM_MISTRAL;
    if (provider.startsWith('cohere')) return SemanticConvention.GEN_AI_SYSTEM_COHERE;
    if (provider.startsWith('amazon') || provider.startsWith('aws')) return SemanticConvention.GEN_AI_SYSTEM_AWS_BEDROCK;
    return VercelAIWrapper.aiSystem;
  }

  static _patchGenerateText(tracer: Tracer): any {
    const genAIEndpoint = 'ai.generateText';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          let metricParams: BaseSpanAttributes | undefined;
          try {
            const response = await originalMethod.apply(this, args);
            const params = args[0] || {};
            const model = params.model;
            const modelId = model?.modelId || 'unknown';
            const aiSystem = VercelAIWrapper._getProviderFromModel(model);

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
            const cost = OpenLitHelper.getChatModelCost(
              modelId,
              pricingInfo,
              response.usage?.promptTokens || 0,
              response.usage?.completionTokens || 0
            );

            VercelAIWrapper.setBaseSpanAttributes(span, { genAIEndpoint, model: modelId, cost, aiSystem });

            span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, params.maxTokens || -1);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, params.temperature ?? 1);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, params.topP ?? 1);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, modelId);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, response.usage?.promptTokens || 0);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, response.usage?.completionTokens || 0);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, response.usage?.totalTokens || 0);
            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, response.usage?.totalTokens || 0);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [response.finishReason || 'stop']);
            span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);

            if (response.toolCalls?.length > 0) {
              const toolNames = response.toolCalls.map((t: any) => t.toolName || '').filter(Boolean);
              const toolArgs = response.toolCalls.map((t: any) => JSON.stringify(t.args || {}));
              if (toolNames.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, toolNames.join(', '));
              if (toolArgs.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, toolArgs);
            }

            if (OpenlitConfig.traceContent) {
              const messages = params.messages || (params.prompt ? [{ role: 'user', content: params.prompt }] : []);
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(messages));
              span.setAttribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                OpenLitHelper.buildOutputMessages(response.text || '', response.finishReason || 'stop', response.toolCalls)
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

  static _patchStreamText(tracer: Tracer): any {
    const genAIEndpoint = 'ai.streamText';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        try {
          const response = await originalMethod.apply(this, args);
          const params = args[0] || {};
          const model = params.model;
          const modelId = model?.modelId || 'unknown';
          const aiSystem = VercelAIWrapper._getProviderFromModel(model);

          // Set request attributes immediately
          span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, params.maxTokens || -1);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, params.temperature ?? 1);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, params.topP ?? 1);

          if (OpenlitConfig.traceContent) {
            const messages = params.messages || (params.prompt ? [{ role: 'user', content: params.prompt }] : []);
            span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(messages));
          }

          // Observe stream completion via usage promise
          Promise.resolve(response.usage)
            .then(async (usage: any) => {
              try {
                const ttft = response.experimental_providerMetadata
                  ? undefined
                  : (Date.now() - startTime) / 1000;
                const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
                const cost = OpenLitHelper.getChatModelCost(
                  modelId,
                  pricingInfo,
                  usage?.promptTokens || 0,
                  usage?.completionTokens || 0
                );

                VercelAIWrapper.setBaseSpanAttributes(span, { genAIEndpoint, model: modelId, cost, aiSystem });

                span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, modelId);
                span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, usage?.promptTokens || 0);
                span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, usage?.completionTokens || 0);
                span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, usage?.totalTokens || 0);
                span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, usage?.totalTokens || 0);
                span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
                if (ttft) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);

                const finishReason = await Promise.resolve(response.finishReason).catch(() => 'stop');
                span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason || 'stop']);

                if (OpenlitConfig.traceContent) {
                  const text = await Promise.resolve(response.text).catch(() => '');
                  span.setAttribute(
                    SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                    OpenLitHelper.buildOutputMessages(text || '', finishReason || 'stop')
                  );
                }

                BaseWrapper.recordMetrics(span, { genAIEndpoint, model: modelId, cost, aiSystem });
              } catch (e: any) {
                OpenLitHelper.handleException(span, e);
              } finally {
                span.end();
              }
            })
            .catch((e: any) => {
              OpenLitHelper.handleException(span, e);
              span.end();
            });

          return response;
        } catch (e: any) {
          OpenLitHelper.handleException(span, e);
          span.end();
          throw e;
        }
      };
    };
  }

  static _patchGenerateObject(tracer: Tracer): any {
    const genAIEndpoint = 'ai.generateObject';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          let metricParams: BaseSpanAttributes | undefined;
          try {
            const response = await originalMethod.apply(this, args);
            const params = args[0] || {};
            const model = params.model;
            const modelId = model?.modelId || 'unknown';
            const aiSystem = VercelAIWrapper._getProviderFromModel(model);

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
            const cost = OpenLitHelper.getChatModelCost(
              modelId,
              pricingInfo,
              response.usage?.promptTokens || 0,
              response.usage?.completionTokens || 0
            );

            VercelAIWrapper.setBaseSpanAttributes(span, { genAIEndpoint, model: modelId, cost, aiSystem });

            span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, params.maxTokens || -1);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, params.temperature ?? 1);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, modelId);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, response.usage?.promptTokens || 0);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, response.usage?.completionTokens || 0);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, response.usage?.totalTokens || 0);
            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, response.usage?.totalTokens || 0);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [response.finishReason || 'stop']);
            span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON);

            if (OpenlitConfig.traceContent) {
              const messages = params.messages || (params.prompt ? [{ role: 'user', content: params.prompt }] : []);
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(messages));
              span.setAttribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                OpenLitHelper.buildOutputMessages(JSON.stringify(response.object || {}), response.finishReason || 'stop')
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

  static _patchEmbed(tracer: Tracer): any {
    const genAIEndpoint = 'ai.embed';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          let metricParams: BaseSpanAttributes | undefined;
          try {
            const response = await originalMethod.apply(this, args);
            const params = args[0] || {};
            const model = params.model;
            const modelId = model?.modelId || 'unknown';
            const aiSystem = VercelAIWrapper._getProviderFromModel(model);

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
            const cost = OpenLitHelper.getEmbedModelCost(modelId, pricingInfo, response.usage?.tokens || 0);

            VercelAIWrapper.setBaseSpanAttributes(span, { genAIEndpoint, model: modelId, cost, aiSystem });

            span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, modelId);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, response.usage?.tokens || 0);
            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, response.usage?.tokens || 0);

            if (OpenlitConfig.traceContent && params.value !== undefined) {
              const inputStr = typeof params.value === 'string' ? params.value : JSON.stringify(params.value);
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputStr);
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
}

export default VercelAIWrapper;
