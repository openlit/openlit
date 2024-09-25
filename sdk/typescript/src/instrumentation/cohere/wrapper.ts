import { Span, SpanKind, SpanStatusCode, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import { SDK_NAME, TELEMETRY_SDK_NAME } from '../../constant';

export default class CohereWrapper {
  static setBaseSpanAttributes(
    span: any,
    { genAIEndpoint, model, user, cost, environment, applicationName }: any
  ) {
    span.setAttributes({
      [TELEMETRY_SDK_NAME]: SDK_NAME,
    });

    span.setAttribute(TELEMETRY_SDK_NAME, SDK_NAME);
    span.setAttribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_COHERE);
    span.setAttribute(SemanticConvention.GEN_AI_ENDPOINT, genAIEndpoint);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, applicationName);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_USER, user);
    if (cost !== undefined) span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, cost);

    span.setStatus({ code: SpanStatusCode.OK });
  }

  static _patchEmbed(tracer: Tracer): any {
    const genAIEndpoint = 'cohere.embed';
    const applicationName = OpenlitConfig.applicationName;
    const environment = OpenlitConfig.environment;
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
              SemanticConvention.GEN_AI_TYPE,
              SemanticConvention.GEN_AI_TYPE_EMBEDDING
            );

            const { dimensions, encoding_format = 'float', input, user, texts = [] } = args[0];
            // Set base span attribues
            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user,
              cost,
              applicationName,
              environment,
            });

            // Request Params attributes : Start

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_EMBEDDING_FORMAT, encoding_format);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_EMBEDDING_DIMENSION, dimensions);
            if (traceContent) {
              span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, JSON.stringify(texts));
            }
            // Request Params attributes : End

            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.id);

            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS,
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
          .then((response) => {
            return OpenAIWrapper._chat({ args, genAIEndpoint, response, span });
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
          .then((response) => {
            return OpenLitHelper.createStreamProxy(
              response,
              OpenAIWrapper._chatGenerator({
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
    try {
      await OpenAIWrapper._chatCommonSetter({
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
        if (chunk.eventType === 'stream-end') {
          result = chunk.response;
        }

        yield chunk;
      }

      await OpenAIWrapper._chatCommonSetter({
        args,
        genAIEndpoint,
        result,
        span,
        stream: true,
      });

      return result;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
    } finally {
      span.end();
    }
  }

  static async _chatCommonSetter({
    args,
    genAIEndpoint,
    result,
    span,
    stream,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    stream: boolean;
  }) {
    const applicationName = OpenlitConfig.applicationName;
    const environment = OpenlitConfig.environment;
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
      span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, message);
    }
    // Request Params attributes : End

    span.setAttribute(SemanticConvention.GEN_AI_TYPE, SemanticConvention.GEN_AI_TYPE_CHAT);

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.response_id);

    const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

    // Calculate cost of the operation
    const cost = OpenLitHelper.getChatModelCost(
      model,
      pricingInfo,
      result.meta.billedUnits.inputTokens,
      result.meta.billedUnits.outputTokens
    );

    OpenAIWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model,
      user,
      cost,
      applicationName,
      environment,
    });

    span.setAttribute(
      SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS,
      result.meta.billedUnits.inputTokens
    );
    span.setAttribute(
      SemanticConvention.GEN_AI_USAGE_COMPLETION_TOKENS,
      result.meta.billedUnits.outputTokens
    );
    span.setAttribute(
      SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
      result.meta.billedUnits.inputTokens + result.meta.billedUnits.outputTokens
    );

    if (result.finishReason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, result.finishReason);
    }

    if (tools) {
      span.setAttribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, 'Function called with tools');
    } else {
      if (traceContent) {
        span.setAttribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, result.text);
      }
    }
  }
}
