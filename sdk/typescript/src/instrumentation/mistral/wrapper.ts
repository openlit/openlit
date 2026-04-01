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
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: MistralWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: MistralWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: MistralWrapper.serverPort,
  };
}

class MistralWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_MISTRAL;
  static serverAddress = 'api.mistral.ai';
  static serverPort = 443;

  static _patchChatCompletionCreate(tracer: Tracer): any {
    const genAIEndpoint = 'mistral.chat.completions';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'mistral-small-latest';
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
            const isStream = args[0]?.stream === true || typeof response[Symbol.asyncIterator] === 'function';

            if (isStream) {
              return OpenLitHelper.createStreamProxy(
                response,
                MistralWrapper._chatCompletionGenerator({
                  args,
                  genAIEndpoint,
                  response,
                  span,
                })
              );
            }

            return MistralWrapper._chatCompletion({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: MistralWrapper.aiSystem,
              serverAddress: MistralWrapper.serverAddress,
              serverPort: MistralWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static async _chatCompletion({
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
      metricParams = await MistralWrapper._chatCompletionCommonSetter({
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

  static async *_chatCompletionGenerator({
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
      const { messages } = args[0];
      let { tools } = args[0];
      const result = {
        id: '0',
        created: -1,
        model: '',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '' },
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };

      const toolCalls: any[] = [];

      for await (const chunk of response) {
        timestamps.push(Date.now());

        const chunkData = chunk.data ?? chunk;

        result.id = chunkData.id || result.id;
        result.created = chunkData.created || result.created;
        result.model = chunkData.model || result.model;

        if (chunkData.choices && chunkData.choices[0]) {
          const chunkFinishReason = chunkData.choices[0].finishReason ?? chunkData.choices[0].finish_reason;
          if (chunkFinishReason) {
            result.choices[0].finish_reason = chunkFinishReason;
          }
          const delta = chunkData.choices[0].delta;
          if (delta?.content) {
            result.choices[0].message.content += delta.content;
          }

          if (delta?.toolCalls || delta?.tool_calls) {
            const deltaTools = delta.toolCalls || delta.tool_calls;

            for (const tool of deltaTools) {
              const idx = tool.index || 0;

              while (toolCalls.length <= idx) {
                toolCalls.push({
                  id: '',
                  type: 'function',
                  function: { name: '', arguments: '' }
                });
              }

              if (tool.id) {
                toolCalls[idx].id = tool.id;
                toolCalls[idx].type = tool.type || 'function';
                if (tool.function?.name) {
                  toolCalls[idx].function.name = tool.function.name;
                }
                if (tool.function?.arguments) {
                  toolCalls[idx].function.arguments = tool.function.arguments;
                }
              } else if (tool.function?.arguments) {
                toolCalls[idx].function.arguments += tool.function.arguments;
              }
            }

            tools = true;
          }
        }

        yield chunk;
      }

      if (toolCalls.length > 0) {
        result.choices[0].message = {
          ...result.choices[0].message,
          tool_calls: toolCalls
        } as any;
      }

      let promptTokens = 0;
      for (const message of messages || []) {
        promptTokens += OpenLitHelper.openaiTokens(message.content as string, result.model) ?? 0;
      }

      const completionTokens = OpenLitHelper.openaiTokens(
        result.choices[0].message.content ?? '',
        result.model
      );

      if (completionTokens) {
        result.usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        };
      }

      args[0].tools = tools;

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await MistralWrapper._chatCompletionCommonSetter({
        args,
        genAIEndpoint,
        result,
        span,
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

  static async _chatCompletionCommonSetter({
    args,
    genAIEndpoint,
    result,
    span,
    ttft = 0,
    tbt = 0,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    ttft?: number;
    tbt?: number;
  }) {
    const captureContent = OpenlitConfig.captureMessageContent;
    const requestModel = args[0]?.model || 'mistral-small-latest';
    const {
      messages,
      frequency_penalty = 0,
      max_tokens = null,
      n = 1,
      presence_penalty = 0,
      seed = null,
      stop = null,
      temperature = 1,
      top_p,
      user,
      stream = false,
    } = args[0];

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p || 1);
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
    if (stop) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, Array.isArray(stop) ? stop : [stop]);
    }
    if (n && n !== 1) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, n);
    }

    if (captureContent) {
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(messages || []));
    }

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);

    const promptTokens = result.usage?.promptTokens ?? result.usage?.prompt_tokens ?? 0;
    const completionTokens = result.usage?.completionTokens ?? result.usage?.completion_tokens ?? 0;

    const responseModel = result.model || requestModel;

    const pricingInfo = OpenlitConfig.pricingInfo || {};

    const cost = OpenLitHelper.getChatModelCost(
      requestModel,
      pricingInfo,
      promptTokens,
      completionTokens
    );

    MistralWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user,
      cost,
      aiSystem: MistralWrapper.aiSystem,
      serverAddress: MistralWrapper.serverAddress,
      serverPort: MistralWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);

    const inputTokens = promptTokens;
    const outputTokens = completionTokens;
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);

    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    const finishReason = result.choices[0].finishReason ?? result.choices[0].finish_reason;
    if (finishReason) {
      span.setAttribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        [finishReason]
      );
    }

    const outputType = typeof result.choices[0].message.content === 'string'
      ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    if (result.choices[0].message.tool_calls) {
      const toolCalls = result.choices[0].message.tool_calls;
      const toolNames = toolCalls.map((t: any) => t.function?.name || '').filter(Boolean);
      const toolIds = toolCalls.map((t: any) => t.id || '').filter(Boolean);
      const toolArgs = toolCalls.map((t: any) => t.function?.arguments || '').filter(Boolean);

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

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;
    if (captureContent) {
      const toolCalls = result.choices[0].message.tool_calls;
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        result.choices[0].message.content || '',
        finishReason || 'stop',
        toolCalls
      );
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      inputMessagesJson = OpenLitHelper.buildInputMessages(messages || []);
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: MistralWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: MistralWrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: result.id,
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
      aiSystem: MistralWrapper.aiSystem,
    };
  }

  static _patchEmbedding(tracer: Tracer): any {
    const genAIEndpoint = 'mistral.embeddings';

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'mistral-embed';
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

            const _responseModel = response.model || requestModel;
            const pricingInfo = OpenlitConfig.pricingInfo || {};
            const promptTokens = response.usage?.promptTokens ?? response.usage?.prompt_tokens ?? 0;
            const cost = OpenLitHelper.getEmbedModelCost(requestModel, pricingInfo, promptTokens);

            const { input, inputs, user, encoding_format = 'float' } = args[0];
            const embeddingInput = input ?? inputs;

            MistralWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: MistralWrapper.aiSystem,
              serverAddress: MistralWrapper.serverAddress,
              serverPort: MistralWrapper.serverPort,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS, [encoding_format]);
            if (captureContent && embeddingInput) {
              const formattedInput = typeof embeddingInput === 'string' ? embeddingInput : JSON.stringify(embeddingInput);
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, formattedInput);
            }

            const embData = response?.data;
            if (Array.isArray(embData) && embData.length > 0 && Array.isArray(embData[0].embedding)) {
              span.setAttribute(SemanticConvention.GEN_AI_EMBEDDINGS_DIMENSION_COUNT, embData[0].embedding.length);
            }

            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
              promptTokens
            );

            metricParams = {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: MistralWrapper.aiSystem,
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
}

export default MistralWrapper;
