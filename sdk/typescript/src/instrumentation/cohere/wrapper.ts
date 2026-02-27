import { Span, SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import { SDK_NAME, TELEMETRY_SDK_NAME } from '../../constant';
import BaseWrapper from '../base-wrapper';

export default class CohereWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_COHERE;
  static serverAddress = 'api.cohere.com';
  static serverPort = 443;
  static _patchEmbed(tracer: Tracer): any {
    const genAIEndpoint = 'cohere.embed';
    const traceContent = OpenlitConfig.traceContent;

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            span.setAttributes({
              [TELEMETRY_SDK_NAME]: SDK_NAME,
            });

            const model = response.model || 'embed-english-v2.0';
            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
            const cost = OpenLitHelper.getEmbedModelCost(
              model,
              pricingInfo,
              response.meta.billedUnits.inputTokens
            );

            span.setAttribute(
              SemanticConvention.GEN_AI_OPERATION,
              SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING
            );

            const { dimensions, encoding_format = 'float', input, user, texts = [] } = args[0];
            // Set base span attribues
            CohereWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user,
              cost,
              aiSystem: CohereWrapper.aiSystem,
            });

            // Request Params attributes : Start
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS, encoding_format);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_EMBEDDING_DIMENSION, dimensions);
            if (traceContent) {
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, JSON.stringify(texts));
            }
            // Request Params attributes : End
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.id);

            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
              response.meta.billedUnits.inputTokens
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
              response.meta.billedUnits.inputTokens
            );

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
          }
        });
      };
    };
  }

  static _patchChat(tracer: Tracer): any {
    const genAIEndpoint = 'cohere.chat';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            return CohereWrapper._chat({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            span.end();
          });
      };
    };
  }

  static _patchChatStream(tracer: Tracer): any {
    const genAIEndpoint = 'cohere.chat';
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
              CohereWrapper._chatGenerator({
                args,
                genAIEndpoint,
                response,
                span,
              })
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
    let metricParams;
    try {
      metricParams = await CohereWrapper._chatCommonSetter({
        args,
        genAIEndpoint,
        result: response,
        span,
        stream: false,
      });
      return response;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
    } finally {
      span.end();
      if (metricParams) {
        BaseWrapper.recordMetrics(span, metricParams);
      }
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
    let metricParams;
    const timestamps: number[] = [];
    const startTime = Date.now();
    try {
      let result = {
        response_id: '',
        text: '',
        generationId: '',
        chatHistory: [],
        finishReason: '',
        meta: {
          apiVersion: { version: '1' },
          billedUnits: { inputTokens: 0, outputTokens: 0 },
        },
      };
      for await (const chunk of response) {
        timestamps.push(Date.now());
        if (chunk.eventType === 'stream-end') {
          result = chunk.response;
        }

        yield chunk;
      }

      // Calculate TTFT and TBT
      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await CohereWrapper._chatCommonSetter({
        args,
        genAIEndpoint,
        result,
        span,
        stream: true,
        ttft,
        tbt,
      });

      return result;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
    } finally {
      span.end();
      // Record metrics after span has ended if parameters are available
      if (metricParams) {
        BaseWrapper.recordMetrics(span, metricParams);
      }
    }
  }

  static async _chatCommonSetter({
    args,
    genAIEndpoint,
    result,
    span,
    stream,
    ttft = 0,
    tbt = 0,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    stream: boolean;
    ttft?: number;
    tbt?: number;
  }) {
    const traceContent = OpenlitConfig.traceContent;
    const {
      message,
      model = 'command-r-plus-08-2024',
      frequency_penalty = 0,
      max_tokens = null,
      presence_penalty = 0,
      seed = null,
      temperature = 1,
      user,
      tools,
    } = args[0];

    // Request Params attributes : Start
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, presence_penalty);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, frequency_penalty);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, seed);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);

    if (traceContent) {
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages([{ role: 'user', content: message }]));
    }
    // Request Params attributes : End

    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.response_id);

    const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

    // Calculate cost of the operation
    const cost = OpenLitHelper.getChatModelCost(
      model,
      pricingInfo,
      result.meta.billedUnits.inputTokens,
      result.meta.billedUnits.outputTokens
    );

    CohereWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: CohereWrapper.aiSystem,
      serverAddress: CohereWrapper.serverAddress,
      serverPort: CohereWrapper.serverPort,
    });

    // Response model
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, model);

    span.setAttribute(
      SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
      result.meta.billedUnits.inputTokens
    );
    span.setAttribute(
      SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
      result.meta.billedUnits.outputTokens
    );
    span.setAttribute(
      SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
      result.meta.billedUnits.inputTokens + result.meta.billedUnits.outputTokens
    );
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, result.meta.billedUnits.inputTokens + result.meta.billedUnits.outputTokens);

    // TTFT and TBT streaming metrics
    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    if (result.finishReason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [result.finishReason]);
    }

    if (traceContent) {
      span.setAttribute(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        OpenLitHelper.buildOutputMessages(result.text || '', result.finishReason || 'stop')
      );
    }

    // Return metric parameters instead of recording metrics directly
    return {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: CohereWrapper.aiSystem,
    };
  }
}
