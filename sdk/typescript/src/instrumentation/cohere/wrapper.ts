import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, { isFrameworkLlmActive, getFrameworkParentContext } from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

function spanCreationAttrs(
  operationName: string,
  requestModel: string
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_COHERE,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: CohereWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: CohereWrapper.serverPort,
  };
}

export default class CohereWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_COHERE;
  static serverAddress = 'api.cohere.com';
  static serverPort = 443;

  static _patchEmbed(tracer: Tracer): any {
    const genAIEndpoint = 'cohere.embed';

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'embed-english-v2.0';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING, requestModel),
        }, effectiveCtx);
        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          const captureContent = OpenlitConfig.captureMessageContent;
          let metricParams: BaseSpanAttributes | undefined;
          try {
            const response = await originalMethod.apply(this, args);

            const responseModel = response.model || requestModel;
            const pricingInfo = OpenlitConfig.pricingInfo || {};
            const inputTokens = response.meta?.billedUnits?.inputTokens || 0;
            const cost = OpenLitHelper.getEmbedModelCost(
              requestModel,
              pricingInfo,
              inputTokens
            );

            const { dimensions, encoding_format = 'float', texts = [], user } = args[0];
            CohereWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: CohereWrapper.aiSystem,
              serverAddress: CohereWrapper.serverAddress,
              serverPort: CohereWrapper.serverPort,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS, [encoding_format]);
            if (dimensions) {
              span.setAttribute(SemanticConvention.GEN_AI_EMBEDDINGS_DIMENSION_COUNT, dimensions);
            }
            if (captureContent) {
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, JSON.stringify(texts));
            }

            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.id);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);

            metricParams = {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: CohereWrapper.aiSystem,
            };

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            throw e;
          } finally {
            span.end();
            if (metricParams) {
              BaseWrapper.recordMetrics(span, metricParams);
            }
          }
        });
      };
    };
  }

  static _patchChat(tracer: Tracer): any {
    const genAIEndpoint = 'cohere.chat';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'command-r-plus-08-2024';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, requestModel),
        }, effectiveCtx);
        return context
          .with(trace.setSpan(effectiveCtx, span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            return CohereWrapper._chat({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: CohereWrapper.aiSystem,
              serverAddress: CohereWrapper.serverAddress,
              serverPort: CohereWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static _patchChatStream(tracer: Tracer): any {
    const genAIEndpoint = 'cohere.chat';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'command-r-plus-08-2024';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, requestModel),
        }, effectiveCtx);
        return context
          .with(trace.setSpan(effectiveCtx, span), async () => {
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
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: CohereWrapper.aiSystem,
              serverAddress: CohereWrapper.serverAddress,
              serverPort: CohereWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
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
      });
      return response;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
      throw e;
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
        chatHistory: [] as any[],
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

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t: number, i: number) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a: number, b: number) => a + b, 0) / timeDiffs.length / 1000;
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
      throw e;
    } finally {
      span.end();
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
    stream = false,
    ttft = 0,
    tbt = 0,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    stream?: boolean;
    ttft?: number;
    tbt?: number;
  }) {
    const captureContent = OpenlitConfig.captureMessageContent;
    const requestModel = args[0]?.model || 'command-r-plus-08-2024';
    const {
      message,
      messages,
      frequency_penalty = 0,
      max_tokens = null,
      presence_penalty = 0,
      seed = null,
      stop_sequences = null,
      temperature = 1,
      p: topP,
      k: topK,
      user,
      tools,
    } = args[0];

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, topP ?? 1);
    if (topK != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, topK);
    }
    if (max_tokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    if (presence_penalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, presence_penalty);
    }
    if (frequency_penalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, frequency_penalty);
    }
    if (seed != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, Number(seed));
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);
    if (stop_sequences) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        Array.isArray(stop_sequences) ? stop_sequences : [stop_sequences]);
    }

    const inputMessages = messages || (message ? [{ role: 'user', content: message }] : []);

    if (captureContent) {
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(inputMessages));
    }

    const responseId = result.response_id || result.id || '';
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, responseId);

    const pricingInfo = OpenlitConfig.pricingInfo || {};

    const inputTokens = result.meta?.billedUnits?.inputTokens
      ?? result.usage?.billed_units?.input_tokens ?? 0;
    const outputTokens = result.meta?.billedUnits?.outputTokens
      ?? result.usage?.billed_units?.output_tokens ?? 0;

    const cost = OpenLitHelper.getChatModelCost(
      requestModel,
      pricingInfo,
      inputTokens,
      outputTokens
    );

    CohereWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user,
      cost,
      aiSystem: CohereWrapper.aiSystem,
      serverAddress: CohereWrapper.serverAddress,
      serverPort: CohereWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, requestModel);

    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);

    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    const finishReason = result.finishReason || result.finish_reason || '';
    if (finishReason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
    }

    const responseText = result.text ?? '';
    const outputType = typeof responseText === 'string'
      ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    const toolCalls = result.toolCalls || result.message?.tool_calls;
    if (toolCalls && Array.isArray(toolCalls)) {
      const toolNames = toolCalls.map((t: any) => t.function?.name || t.name || '').filter(Boolean);
      const toolIds = toolCalls.map((t: any) => t.id || '').filter(Boolean);
      const toolArgs = toolCalls.map((t: any) => t.function?.arguments || t.arguments || '').filter(Boolean);

      if (toolNames.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, toolNames.join(', '));
      }
      if (toolIds.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, toolIds.join(', '));
      }
      if (toolArgs.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_ARGS, toolArgs.join(', '));
      }
    }

    const toolPlan = result.toolPlan || result.message?.tool_plan;
    if (toolPlan) {
      span.setAttribute(SemanticConvention.GEN_AI_CONTENT_REASONING, toolPlan);
    }

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;
    if (captureContent) {
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        responseText,
        finishReason || 'stop',
        toolCalls
      );
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      inputMessagesJson = OpenLitHelper.buildInputMessages(inputMessages);
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: requestModel,
        [SemanticConvention.SERVER_ADDRESS]: CohereWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: CohereWrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: responseId,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason || 'stop'],
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
      };
      if (captureContent) {
        if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
        if (outputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
      }
      OpenLitHelper.emitInferenceEvent(span, eventAttrs);
    }

    return {
      genAIEndpoint,
      model: requestModel,
      user,
      cost,
      aiSystem: CohereWrapper.aiSystem,
    };
  }
}
