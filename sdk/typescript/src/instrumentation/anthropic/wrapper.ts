import { Span, SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

type BaseSpanAttributes = {
  genAIEndpoint: string;
  model: string;
  user: string;
  cost: number;
  aiSystem: string;
};

export default class AnthropicWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC;

  static _patchMessageCreate(tracer: Tracer): any {
    const genAIEndpoint = 'anthropic.resources.messages';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        const { stream = false } = args[0];
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            if (!!stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                AnthropicWrapper._messageCreateGenerator({
                  args,
                  genAIEndpoint,
                  response,
                  span,
                })
              );
            }

            return AnthropicWrapper._messageCreate({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e as Error);
            span.end();
            throw e;
          });
      };
    };
  }

  static async _messageCreate({
    args,
    genAIEndpoint,
    response,
    span,
  }: {
    args: Record<string, unknown>[];
    genAIEndpoint: string;
    response: Record<string, unknown>;
    span: Span;
  }) {
    try {
      const metricParams = await AnthropicWrapper._messageCreateCommonSetter({
        args,
        genAIEndpoint,
        result: response,
        span,
      });

      BaseWrapper.recordMetrics(span, metricParams);

      return response;
    } catch (e: unknown) {
      OpenLitHelper.handleException(span, e as Error);
    } finally {
      span.end();
    }
  }

  static async *_messageCreateGenerator({
    args,
    genAIEndpoint,
    response,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
  }) {
    try {
      const result = {
        id: '0',
        model: '',
        stop_reason: '',
        content: [
          {
            text: '',
            role: '',
          },
        ],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
      };
      for await (const chunk of response) {
        switch (chunk.type) {
          case 'content_block_delta':
            result.content[0].text += chunk.delta?.text ?? '';
            break;
          case 'message_stop':
            break;

          case 'content_block_stop':
            break;

          case 'message_start':
            if (chunk.message) {
              result.id = chunk.message.id;
              result.model = chunk.message.model;
              result.content[0].role = chunk.message.role;
              result.usage.input_tokens += Number(chunk.message.usage?.input_tokens) ?? 0;
              result.usage.output_tokens += Number(chunk.message.usage?.output_tokens) ?? 0;
              result.stop_reason = chunk.message?.stop_reason ?? '';
            }
            break;

          case 'content_block_start':
            result.content[0].text = chunk.content_block?.text ?? '';
            break;
          case 'message_delta':
            result.stop_reason = chunk.delta?.stop_reason ?? '';
            result.usage.output_tokens += Number(chunk.usage?.output_tokens) ?? 0;
            break;
        }

        yield chunk;
      }

      result.usage.total_tokens = result.usage.output_tokens + result.usage.input_tokens;

      await AnthropicWrapper._messageCreateCommonSetter({
        args,
        genAIEndpoint,
        result,
        span,
      });
      return response;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
    } finally {
      span.end();
    }
  }

  static async _messageCreateCommonSetter({
    args,
    genAIEndpoint,
    result,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
  }): Promise<BaseSpanAttributes> {
    const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

    // Calculate cost of the operation
    const cost = OpenLitHelper.getChatModelCost(
      result.model,
      pricingInfo,
      result.usage.input_tokens,
      result.usage.output_tokens
    );

    const attributes = {
      genAIEndpoint,
      model: result.model,
      user: args[0]?.user || 'unknown',
      cost,
      aiSystem: AnthropicWrapper.aiSystem,
    };

    AnthropicWrapper.setBaseSpanAttributes(span, attributes);

    return attributes;
  }
}
