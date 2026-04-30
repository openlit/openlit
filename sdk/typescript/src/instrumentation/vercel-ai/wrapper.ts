import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

function spanCreationAttrs(
  operationName: string,
  requestModel: string
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: VercelAIWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: VercelAIWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: VercelAIWrapper.serverPort,
  };
}

class VercelAIWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_VERCEL_AI;
  static serverAddress = 'vercel.ai';
  static serverPort = 443;

  static _patchGenerateText(tracer: Tracer): any {
    const genAIEndpoint = 'vercel_ai.generateText';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const params = args[0] || {};
        const modelId = params.model?.modelId || 'unknown';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${modelId}`;
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, modelId),
        });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            return VercelAIWrapper._chatComplete({
              args,
              genAIEndpoint,
              response,
              span,
              outputType: SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
            });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: modelId,
              aiSystem: VercelAIWrapper.aiSystem,
              serverAddress: VercelAIWrapper.serverAddress,
              serverPort: VercelAIWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static _patchStreamText(tracer: Tracer): any {
    const genAIEndpoint = 'vercel_ai.streamText';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const params = args[0] || {};
        const modelId = params.model?.modelId || 'unknown';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${modelId}`;
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, modelId),
        });
        const startTime = Date.now();
        const chunkTimestamps: number[] = [];

        try {
          const response = await context.with(
            trace.setSpan(context.active(), span),
            async () => originalMethod.apply(this, args)
          );

          try {
            const originalTextStream = response.textStream as ReadableStream<string>;
            if (originalTextStream && typeof originalTextStream.getReader === 'function') {
              const reader = originalTextStream.getReader();
              const wrappedTextStream = new ReadableStream<string>({
                async pull(controller) {
                  const { done, value } = await reader.read();
                  if (done) {
                    controller.close();
                  } else {
                    chunkTimestamps.push(Date.now());
                    controller.enqueue(value);
                  }
                },
                cancel() {
                  reader.cancel();
                },
              });
              Object.defineProperty(response, 'textStream', {
                value: wrappedTextStream,
                writable: true,
                configurable: true,
              });
            }
          } catch (_) {
            // Stream interception is best-effort; TTFT/TBT won't be captured
          }

          Promise.resolve(response.usage)
            .then(async (usage: any) => {
              let metricParams;
              try {
                const ttft = chunkTimestamps.length > 0 ? (chunkTimestamps[0] - startTime) / 1000 : 0;
                let tbt = 0;
                if (chunkTimestamps.length > 1) {
                  const timeDiffs = chunkTimestamps.slice(1).map((t, i) => t - chunkTimestamps[i]);
                  tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
                }

                const finishReason = await Promise.resolve(response.finishReason).catch(() => 'stop');
                const text = await Promise.resolve(response.text).catch(() => '');
                const toolCalls = await Promise.resolve(response.toolCalls).catch(() => undefined);
                const responseDetails = await Promise.resolve(response.response).catch(() => undefined);

                const result = {
                  usage: {
                    promptTokens: usage?.promptTokens || 0,
                    completionTokens: usage?.completionTokens || 0,
                  },
                  finishReason: finishReason || 'stop',
                  text: text || '',
                  toolCalls,
                  response: responseDetails,
                };

                metricParams = await VercelAIWrapper._chatCommonSetter({
                  args,
                  genAIEndpoint,
                  result,
                  span,
                  isStream: true,
                  outputType: SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
                  ttft,
                  tbt,
                });
              } catch (e: any) {
                OpenLitHelper.handleException(span, e);
              } finally {
                span.end();
                if (metricParams) {
                  BaseWrapper.recordMetrics(span, metricParams);
                }
              }
            })
            .catch((e: any) => {
              OpenLitHelper.handleException(span, e);
              BaseWrapper.recordMetrics(span, {
                genAIEndpoint,
                model: modelId,
                aiSystem: VercelAIWrapper.aiSystem,
                serverAddress: VercelAIWrapper.serverAddress,
                serverPort: VercelAIWrapper.serverPort,
                errorType: e?.constructor?.name || '_OTHER',
              });
              span.end();
            });

          return response;
        } catch (e: any) {
          OpenLitHelper.handleException(span, e);
          BaseWrapper.recordMetrics(span, {
            genAIEndpoint,
            model: modelId,
            aiSystem: VercelAIWrapper.aiSystem,
            serverAddress: VercelAIWrapper.serverAddress,
            serverPort: VercelAIWrapper.serverPort,
            errorType: e?.constructor?.name || '_OTHER',
          });
          span.end();
          throw e;
        }
      };
    };
  }

  static _patchGenerateObject(tracer: Tracer): any {
    const genAIEndpoint = 'vercel_ai.generateObject';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const params = args[0] || {};
        const modelId = params.model?.modelId || 'unknown';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${modelId}`;
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, modelId),
        });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            const result = {
              ...response,
              text: JSON.stringify(response.object || {}),
            };
            return VercelAIWrapper._chatComplete({
              args,
              genAIEndpoint,
              response,
              span,
              outputType: SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON,
              resultOverride: result,
            });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: modelId,
              aiSystem: VercelAIWrapper.aiSystem,
              serverAddress: VercelAIWrapper.serverAddress,
              serverPort: VercelAIWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static _patchEmbed(tracer: Tracer): any {
    const genAIEndpoint = 'vercel_ai.embed';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const params = args[0] || {};
        const modelId = params.model?.modelId || 'unknown';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} ${modelId}`;
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING, modelId),
        });
        return context.with(trace.setSpan(context.active(), span), async () => {
          const captureContent = OpenlitConfig.captureMessageContent;
          let metricParams: BaseSpanAttributes | undefined;
          try {
            const response = await originalMethod.apply(this, args);

            const pricingInfo = OpenlitConfig.pricingInfo || {};
            const inputTokens = response.usage?.tokens || 0;
            const cost = OpenLitHelper.getEmbedModelCost(modelId, pricingInfo, inputTokens);

            VercelAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model: modelId,
              cost,
              aiSystem: VercelAIWrapper.aiSystem,
              serverAddress: VercelAIWrapper.serverAddress,
              serverPort: VercelAIWrapper.serverPort,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);

            if (captureContent && params.value !== undefined) {
              const inputStr = typeof params.value === 'string' ? params.value : JSON.stringify(params.value);
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputStr);
            }

            metricParams = {
              genAIEndpoint,
              model: modelId,
              cost,
              aiSystem: VercelAIWrapper.aiSystem,
              serverAddress: VercelAIWrapper.serverAddress,
              serverPort: VercelAIWrapper.serverPort,
            };
            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            metricParams = {
              genAIEndpoint,
              model: modelId,
              aiSystem: VercelAIWrapper.aiSystem,
              serverAddress: VercelAIWrapper.serverAddress,
              serverPort: VercelAIWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            };
            throw e;
          } finally {
            span.end();
            if (metricParams) BaseWrapper.recordMetrics(span, metricParams);
          }
        });
      };
    };
  }

  static async _chatComplete({
    args,
    genAIEndpoint,
    response,
    span,
    outputType,
    resultOverride,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
    outputType: string;
    resultOverride?: any;
  }): Promise<any> {
    let metricParams;
    try {
      metricParams = await VercelAIWrapper._chatCommonSetter({
        args,
        genAIEndpoint,
        result: resultOverride || response,
        span,
        isStream: false,
        outputType,
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

  static async _chatCommonSetter({
    args,
    genAIEndpoint,
    result,
    span,
    isStream,
    outputType,
    ttft = 0,
    tbt = 0,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    isStream: boolean;
    outputType: string;
    ttft?: number;
    tbt?: number;
  }) {
    const captureContent = OpenlitConfig.captureMessageContent;
    const params = args[0] || {};
    const modelId = params.model?.modelId || 'unknown';

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, params.temperature ?? 1);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, params.topP ?? 1);
    if (params.maxTokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, params.maxTokens);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, isStream);
    if (params.seed != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, Number(params.seed));
    }
    if (params.frequencyPenalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, params.frequencyPenalty);
    }
    if (params.presencePenalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, params.presencePenalty);
    }
    if (params.stopSequences) {
      span.setAttribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        Array.isArray(params.stopSequences) ? params.stopSequences : [params.stopSequences]
      );
    }
    if (params.topK != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, params.topK);
    }

    const messages = params.messages || (params.prompt ? [{ role: 'user', content: params.prompt }] : []);

    if (captureContent) {
      span.setAttribute(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        OpenLitHelper.buildInputMessages(messages, params.system)
      );
    }

    const responseId = result.response?.id;
    const responseModel = result.response?.modelId || modelId;
    const inputTokens = result.usage?.promptTokens || 0;
    const outputTokens = result.usage?.completionTokens || 0;

    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getChatModelCost(modelId, pricingInfo, inputTokens, outputTokens);

    VercelAIWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: modelId,
      cost,
      aiSystem: VercelAIWrapper.aiSystem,
      serverAddress: VercelAIWrapper.serverAddress,
      serverPort: VercelAIWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
    if (responseId) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, responseId);
    }
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);

    const finishReason = result.finishReason || 'stop';
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    if (result.toolCalls?.length > 0) {
      const toolNames = result.toolCalls.map((t: any) => t.toolName || '').filter(Boolean);
      const toolIds = result.toolCalls.map((t: any) => t.toolCallId || '').filter(Boolean);
      const toolArgs = result.toolCalls.map((t: any) => JSON.stringify(t.args || {})).filter(Boolean);

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

    const normalizedToolCalls = result.toolCalls?.map((t: any) => ({
      id: t.toolCallId || '',
      name: t.toolName || '',
      arguments: t.args || {},
    }));

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;
    if (captureContent) {
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        result.text || '',
        finishReason,
        normalizedToolCalls
      );
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      inputMessagesJson = OpenLitHelper.buildInputMessages(messages, params.system);
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: modelId,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: VercelAIWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: VercelAIWrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason],
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
      };
      if (responseId) {
        eventAttrs[SemanticConvention.GEN_AI_RESPONSE_ID] = responseId;
      }
      if (captureContent) {
        if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
        if (outputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
      }
      OpenLitHelper.emitInferenceEvent(span, eventAttrs);
    }

    return {
      genAIEndpoint,
      model: modelId,
      cost,
      aiSystem: VercelAIWrapper.aiSystem,
      serverAddress: VercelAIWrapper.serverAddress,
      serverPort: VercelAIWrapper.serverPort,
    };
  }
}

export default VercelAIWrapper;
