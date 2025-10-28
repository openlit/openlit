import { Span, SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

export default class MistralWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_MISTRAL;

  static _patchChat(tracer: Tracer): any {
    const genAIEndpoint = 'mistral.chat';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            return MistralWrapper._chat({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            span.end();
          });
      };
    };
  }

  static _patchChatStream(tracer: Tracer): any {
    const genAIEndpoint = 'mistral.chatStream';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            return OpenLitHelper.createStreamProxy(
              response,
              MistralWrapper._chatGenerator({ args, genAIEndpoint, response, span })
            );
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            span.end();
          });
      };
    };
  }

  static async _chat({
    args,
    genAIEndpoint,
    response,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
  }): Promise<any> {
    let metricParams: BaseSpanAttributes | undefined;
    try {
      metricParams = await MistralWrapper._chatCommonSetter({
        args,
        genAIEndpoint,
        result: response,
        span,
      });
      return response;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
    } finally {
      span.end();
      if (metricParams) BaseWrapper.recordMetrics(span, metricParams);
    }
  }

  static async *_chatGenerator({
    args,
    genAIEndpoint,
    response,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
  }): AsyncGenerator<unknown, any, unknown> {
    let metricParams: BaseSpanAttributes | undefined;
    try {
      // The SDK returns an async iterator where final response is available
      // at the end; we accumulate minimal fields for metrics.
      let result: any = { model: '', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, id: '', choices: [{ message: { content: '' }, finish_reason: '' }] };
      for await (const chunk of response) {
        // Depending on SDK format, merge useful fields when present
        if (chunk?.id) result.id = chunk.id;
        if (chunk?.model) result.model = chunk.model;
        if (chunk?.usage) {
          result.usage.prompt_tokens = Number(chunk.usage.prompt_tokens ?? result.usage.prompt_tokens);
          result.usage.completion_tokens = Number(chunk.usage.completion_tokens ?? result.usage.completion_tokens);
          result.usage.total_tokens = Number(chunk.usage.total_tokens ?? (result.usage.prompt_tokens + result.usage.completion_tokens));
        }
        if (chunk?.choices?.[0]?.delta?.content) {
          result.choices[0].message.content = (result.choices[0].message.content || '') + chunk.choices[0].delta.content;
        }
        if (chunk?.choices?.[0]?.finish_reason) {
          result.choices[0].finish_reason = chunk.choices[0].finish_reason;
        }
        yield chunk;
      }

      metricParams = await MistralWrapper._chatCommonSetter({ args, genAIEndpoint, result, span });
      return result;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
    } finally {
      span.end();
      if (metricParams) BaseWrapper.recordMetrics(span, metricParams);
    }
  }

  static async _chatCommonSetter({
    args,
    genAIEndpoint,
    result,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
  }) {
    const traceContent = OpenlitConfig.traceContent;
    const {
      messages,
      max_tokens = null,
      seed = null,
      temperature = 1,
      top_p,
      user,
      stream = false,
      tools,
    } = args[0] || {};

    // Request params
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, seed);

    // Content prompt
    if (traceContent) {
      const messagePrompt = messages || [];
      const formattedMessages: string[] = [];
      for (const message of messagePrompt) {
        const role = message.role;
        const content = message.content;
        if (Array.isArray(content)) {
          const contentStr = content
            .map((item: any) => ('type' in item ? `${item.type}: ${item.text ?? item.image_url}` : `text: ${item.text}`))
            .join(', ');
          formattedMessages.push(`${role}: ${contentStr}`);
        } else {
          formattedMessages.push(`${role}: ${content}`);
        }
      }
      const prompt = formattedMessages.join('\n');
      span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, prompt);
    }

    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);

    const model = result?.model || args?.[0]?.model || 'mistral-small-latest';
    const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

    const promptTokens = Number(result?.usage?.prompt_tokens ?? 0);
    const completionTokens = Number(result?.usage?.completion_tokens ?? 0);
    const totalTokens = Number(result?.usage?.total_tokens ?? (promptTokens + completionTokens));

    const cost = OpenLitHelper.getChatModelCost(model, pricingInfo, promptTokens, completionTokens);

    MistralWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: MistralWrapper.aiSystem,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result?.id);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);

    if (result?.choices?.[0]?.finish_reason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, result.choices[0].finish_reason);
    }

    if (tools) {
      span.setAttribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, 'Function called with tools');
    } else if (traceContent) {
      span.setAttribute(
        SemanticConvention.GEN_AI_CONTENT_COMPLETION,
        result?.choices?.[0]?.message?.content || ''
      );
    }

    return {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: MistralWrapper.aiSystem,
    };
  }

  static _patchEmbeddings(tracer: Tracer): any {
    const genAIEndpoint = 'mistral.embeddings';
    const traceContent = OpenlitConfig.traceContent;

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          let metricParams: BaseSpanAttributes = {
            genAIEndpoint,
            model: '',
            user: '',
            cost: 0,
            aiSystem: MistralWrapper.aiSystem,
          };
          try {
            const response = await originalMethod.apply(this, args);

            const model = response?.model || args?.[0]?.model || 'mistral-embed';
            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
            const inputTokens = Number(response?.usage?.prompt_tokens ?? 0);
            const cost = OpenLitHelper.getEmbedModelCost(model, pricingInfo, inputTokens);

            span.setAttribute(
              SemanticConvention.GEN_AI_OPERATION,
              SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING
            );

            const { dimensions, encoding_format = 'float', input, user } = args[0] || {};
            MistralWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user,
              cost,
              aiSystem: MistralWrapper.aiSystem,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS, encoding_format);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_EMBEDDING_DIMENSION, dimensions);
            if (traceContent) {
              span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, input);
            }

            span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, inputTokens);

            metricParams = { genAIEndpoint, model, user, cost, aiSystem: MistralWrapper.aiSystem };

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
            BaseWrapper.recordMetrics(span, metricParams);
          }
        });
      };
    };
  }
}
