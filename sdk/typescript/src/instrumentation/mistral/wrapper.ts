import { Span, SpanKind, Tracer } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

export default class MistralWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_MISTRAL;

  // Wrap Mistral provider: functions return models
  static wrapProvider(provider: any, tracer: Tracer) {
    if (!provider) return provider;
    const wrapped: any = function (modelId: string, settings?: any) {
      const model = provider(modelId, settings);
      return MistralWrapper.wrapLanguageModel(model, tracer);
    };
    // mirror provider methods
    for (const key of Object.keys(provider)) {
      wrapped[key] = provider[key];
    }
    if (typeof provider.languageModel === 'function') {
      wrapped.languageModel = function (...args: any[]) {
        const model = provider.languageModel.apply(provider, args);
        return MistralWrapper.wrapLanguageModel(model, tracer);
      };
    }
    if (typeof provider.chat === 'function') {
      wrapped.chat = function (...args: any[]) {
        const model = provider.chat.apply(provider, args);
        return MistralWrapper.wrapLanguageModel(model, tracer);
      };
    }
    if (typeof provider.textEmbeddingModel === 'function') {
      wrapped.textEmbeddingModel = function (...args: any[]) {
        const model = provider.textEmbeddingModel.apply(provider, args);
        return MistralWrapper.wrapEmbeddingModel(model, tracer);
      };
    }
    if (typeof provider.embedding === 'function') {
      wrapped.embedding = function (...args: any[]) {
        const model = provider.embedding.apply(provider, args);
        return MistralWrapper.wrapEmbeddingModel(model, tracer);
      };
    }
    return wrapped;
  }

  // Wrap AI SDK LanguageModelV1 to intercept doGenerate and doStream
  static wrapLanguageModel(model: any, tracer: Tracer) {
    if (!model || typeof model !== 'object') return model;
    const wrapped: any = Object.create(model);

    if (typeof model.doGenerate === 'function') {
      wrapped.doGenerate = async (options: any) => {
        const genAIEndpoint = 'ai.mistral.languageModel.generate';
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        let metricParams;
        try {
          const result = await model.doGenerate(options);
          metricParams = await MistralWrapper._setChatAttributesFromAISDK({ span, options, result, genAIEndpoint });
          return result;
        } catch (e: any) {
          OpenLitHelper.handleException(span as any, e);
          throw e;
        } finally {
          span.end();
          if (metricParams) BaseWrapper.recordMetrics(span as any, metricParams);
        }
      };
    }

    if (typeof model.doStream === 'function') {
      wrapped.doStream = async (options: any) => {
        const genAIEndpoint = 'ai.mistral.languageModel.stream';
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        let metricParams;
        try {
          const streamResult = await model.doStream(options);
          // The AI SDK returns a ReadableStream of parts and usage in finish part.
          const { stream } = streamResult;
          const reader = stream.getReader();
          let text = '';
          let usage = { promptTokens: 0, completionTokens: 0 } as any;
          let responseMeta: any = {};
          const newStream = new ReadableStream({
            async pull(controller) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                return;
              }
              if (value?.type === 'text-delta') text += value.textDelta || '';
              if (value?.type === 'response-metadata') {
                responseMeta = value;
              }
              if (value?.type === 'finish') {
                usage = value.usage || usage;
              }
              controller.enqueue(value);
            },
          });

          // After wrapping stream, set attributes and return same shape
          metricParams = await MistralWrapper._setChatAttributesFromAISDK({
            span,
            options,
            result: {
              text,
              finishReason: responseMeta?.finishReason,
              usage,
              response: { id: responseMeta?.id, modelId: responseMeta?.modelId },
            },
            genAIEndpoint,
          });

          return { ...streamResult, stream: newStream };
        } catch (e: any) {
          OpenLitHelper.handleException(span as any, e);
          throw e;
        } finally {
          span.end();
          if (metricParams) BaseWrapper.recordMetrics(span as any, metricParams);
        }
      };
    }

    return wrapped;
  }

  // Wrap AI SDK EmbeddingModelV1 to intercept doEmbed
  static wrapEmbeddingModel(model: any, tracer: Tracer) {
    if (!model || typeof model !== 'object') return model;
    const wrapped: any = Object.create(model);
    if (typeof model.doEmbed === 'function') {
      wrapped.doEmbed = async (options: any) => {
        const genAIEndpoint = 'ai.mistral.embeddingModel.embed';
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        try {
          const result = await model.doEmbed(options);

          const modelId = model?.modelId || 'mistral-embed';
          const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
          const inputTokens = Number(result?.usage?.tokens ?? 0);
          const cost = OpenLitHelper.getEmbedModelCost(modelId, pricingInfo, inputTokens);

          MistralWrapper.setBaseSpanAttributes(span as any, {
            genAIEndpoint,
            model: modelId,
            user: undefined,
            cost,
            aiSystem: MistralWrapper.aiSystem,
          });

          span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING);
          span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
          span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, inputTokens);
          return result;
        } catch (e: any) {
          OpenLitHelper.handleException(span as any, e);
          throw e;
        } finally {
          span.end();
        }
      };
    }
    return wrapped;
  }

  private static async _setChatAttributesFromAISDK({
    span,
    options,
    result,
    genAIEndpoint,
  }: {
    span: Span;
    options: any;
    result: any;
    genAIEndpoint: string;
  }) {
    const traceContent = OpenlitConfig.traceContent;
    const settings = options || {};

    const model = result?.response?.modelId || settings?.mode?.modelId || settings?.modelId || 'mistral-small-latest';

    const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

    const promptTokens = Number(result?.usage?.promptTokens ?? 0);
    const completionTokens = Number(result?.usage?.completionTokens ?? 0);
    const totalTokens = promptTokens + completionTokens;

    const cost = OpenLitHelper.getChatModelCost(model, pricingInfo, promptTokens, completionTokens);

    MistralWrapper.setBaseSpanAttributes(span as any, {
      genAIEndpoint,
      model,
      user: undefined,
      cost,
      aiSystem: MistralWrapper.aiSystem,
    });

    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
    if (result?.response?.id) span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.response.id);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);

    if (traceContent && typeof result?.text === 'string') {
      span.setAttribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, result.text);
    }

    // Map common call settings if available
    const { maxTokens, temperature, topP, seed } = settings;
    if (maxTokens !== undefined) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, maxTokens);
    if (temperature !== undefined) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    if (topP !== undefined) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, topP);
    if (seed !== undefined) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, seed);

    // Prompt content is not standardized across AI SDK; try to pick from options.prompt
    if (traceContent && settings?.prompt) {
      try {
        const promptText = Array.isArray(settings.prompt)
          ? settings.prompt.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('\n')
          : String(settings.prompt);
        span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, promptText);
      } catch {}
    }

    return { genAIEndpoint, model, user: undefined, cost, aiSystem: MistralWrapper.aiSystem };
  }
}
