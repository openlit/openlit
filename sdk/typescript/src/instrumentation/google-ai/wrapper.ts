import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, { isFrameworkLlmActive, getFrameworkParentContext } from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

function spanCreationAttrs(
  operationName: string,
  requestModel: string
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: GoogleAIWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: GoogleAIWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: GoogleAIWrapper.serverPort,
  };
}

class GoogleAIWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO;
  static serverAddress = 'generativelanguage.googleapis.com';
  static serverPort = 443;

  static _patchGenerateContent(tracer: Tracer): any {
    const genAIEndpoint = 'google.generativeai.models.generate_content';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const rawModel = this?.model || 'gemini-2.0-flash';
        const requestModel = rawModel.replace(/^models\//, '');
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
            if (response && response.stream && typeof response.stream[Symbol.asyncIterator] === 'function') {
              const wrappedStream = GoogleAIWrapper._generateContentStreamGenerator({
                args,
                genAIEndpoint,
                response: response.stream,
                span,
                requestModel,
              });
              return { ...response, stream: wrappedStream };
            }

            return GoogleAIWrapper._generateContent({ args, genAIEndpoint, response, span, requestModel });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: GoogleAIWrapper.aiSystem,
              serverAddress: GoogleAIWrapper.serverAddress,
              serverPort: GoogleAIWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static async _generateContent({
    args,
    genAIEndpoint,
    response,
    span,
    requestModel,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
    requestModel: string;
  }): Promise<any> {
    let metricParams;
    try {
      metricParams = await GoogleAIWrapper._generateContentCommonSetter({
        args,
        genAIEndpoint,
        result: response,
        span,
        requestModel,
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

  static async *_generateContentStreamGenerator({
    args,
    genAIEndpoint,
    response,
    span,
    requestModel,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
    requestModel: string;
  }): AsyncGenerator<unknown, any, unknown> {
    let metricParams;
    const timestamps: number[] = [];
    const startTime = Date.now();

    try {
      const result = {
        model: '',
        text: '',
        responseId: '',
        candidates: [] as any[],
        usageMetadata: {
          promptTokenCount: 0,
          candidatesTokenCount: 0,
          totalTokenCount: 0,
        },
        functionCall: null as any,
      };

      for await (const chunk of response) {
        timestamps.push(Date.now());

        if (chunk.modelVersion || chunk.model) {
          result.model = chunk.modelVersion || chunk.model;
        }

        if (chunk.responseId) {
          result.responseId = chunk.responseId;
        }

        const chunkText = typeof chunk.text === 'function' ? chunk.text() : chunk.text;
        if (chunkText) {
          result.text += chunkText;
        }

        if (chunk.candidates && chunk.candidates.length > 0) {
          if (result.candidates.length === 0) {
            result.candidates = chunk.candidates.map((c: any) => ({
              content: { parts: [{ text: '' }], role: 'model' },
              finishReason: c.finishReason || '',
              safetyRatings: c.safetyRatings || [],
            }));
          }

          chunk.candidates.forEach((c: any, idx: number) => {
            if (c.content?.parts) {
              c.content.parts.forEach((part: any) => {
                if (part.text) {
                  result.candidates[idx].content.parts[0].text += part.text;
                }
                if (part.functionCall) {
                  result.functionCall = part.functionCall;
                }
              });
            }
            if (c.finishReason) {
              result.candidates[idx].finishReason = c.finishReason;
            }
          });
        }

        if (chunk.usageMetadata) {
          result.usageMetadata = {
            promptTokenCount: chunk.usageMetadata.promptTokenCount || result.usageMetadata.promptTokenCount,
            candidatesTokenCount: chunk.usageMetadata.candidatesTokenCount || result.usageMetadata.candidatesTokenCount,
            totalTokenCount: chunk.usageMetadata.totalTokenCount || result.usageMetadata.totalTokenCount,
          };
        }

        yield chunk;
      }

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await GoogleAIWrapper._generateContentCommonSetter({
        args,
        genAIEndpoint,
        result,
        span,
        requestModel,
        ttft,
        tbt,
        isStream: true,
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

  static async _generateContentCommonSetter({
    args,
    genAIEndpoint,
    result,
    span,
    requestModel,
    ttft = 0,
    tbt = 0,
    isStream = false,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    requestModel: string;
    ttft?: number;
    tbt?: number;
    isStream?: boolean;
  }) {
    const captureContent = OpenlitConfig.captureMessageContent;
    // Non-streaming: result = { response: GenerateContentResponse }
    // Streaming: result = our accumulated plain object
    const responseData = result.response || result;
    const config = args[0]?.config || args[1] || {};
    const {
      temperature,
      maxOutputTokens,
      topP,
      topK,
      stopSequences,
      frequencyPenalty,
      presencePenalty,
    } = config;

    // Request param attributes — only set when explicitly provided (matches Python)
    if (temperature != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    }
    if (maxOutputTokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, maxOutputTokens);
    }
    if (topP != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, topP);
    }
    if (topK != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, topK);
    }
    if (stopSequences) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, stopSequences);
    }
    if (frequencyPenalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, frequencyPenalty);
    }
    if (presencePenalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, presencePenalty);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, isStream);

    const responseModel = responseData.modelVersion || responseData.model || requestModel;

    const pricingInfo = OpenlitConfig.pricingInfo || {};

    const usageMetadata = responseData.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;

    const cost = OpenLitHelper.getChatModelCost(
      requestModel,
      pricingInfo,
      inputTokens,
      outputTokens
    );

    GoogleAIWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user: undefined,
      cost,
      aiSystem: GoogleAIWrapper.aiSystem,
      serverAddress: GoogleAIWrapper.serverAddress,
      serverPort: GoogleAIWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);

    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);

    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    // Response ID
    const responseId = responseData.responseId || '';
    if (responseId) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, responseId);
    }

    // Finish reason
    const finishReason = responseData.candidates?.[0]?.finishReason || '';
    if (finishReason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
    }

    // Output type
    const completionText = isStream
      ? responseData.text
      : (typeof responseData.text === 'function' ? responseData.text() : responseData.text);
    const outputType = typeof completionText === 'string'
      ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    // Function calls / tool calls (matches Python: tool name, call id, args)
    const functionCall = isStream
      ? responseData.functionCall
      : responseData.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)?.functionCall;
    if (functionCall) {
      if (functionCall.name) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, functionCall.name);
      }
      if (functionCall.args) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_ARGS, JSON.stringify(functionCall.args));
      }
    }

    // Reasoning tokens (Google: thoughts_token_count)
    const reasoningTokens = usageMetadata?.thoughtsTokenCount || 0;
    if (reasoningTokens > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS, reasoningTokens);
    }

    // Cache tokens (matches Python: cached_content_token_count, cache_creation_input_tokens)
    const cacheReadTokens = usageMetadata?.cachedContentTokenCount || 0;
    if (cacheReadTokens) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheReadTokens);
    }
    const cacheCreationTokens = usageMetadata?.cacheCreationInputTokens || 0;
    if (cacheCreationTokens) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheCreationTokens);
    }

    // Content attributes (gated by captureMessageContent)
    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;
    if (captureContent) {
      const contents = args[0]?.contents || args[0];
      let messages: any[] = [];
      if (typeof contents === 'string') {
        messages = [{ role: 'user', content: contents }];
      } else if (Array.isArray(contents)) {
        messages = contents.map((item: any) => ({
          role: item.role === 'model' ? 'assistant' : (item.role || 'user'),
          content: Array.isArray(item.parts)
            ? item.parts.map((p: any) => p.text || '').join(' ')
            : (item.parts || ''),
        }));
      }
      inputMessagesJson = OpenLitHelper.buildInputMessages(messages);
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);

      const outputContent = completionText
        || (responseData.candidates?.[0]?.content?.parts?.[0]?.text)
        || '';
      const toolCallsForOutput = functionCall ? [{
        name: functionCall.name || '',
        arguments: functionCall.args || {},
      }] : undefined;
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        outputContent,
        finishReason || 'stop',
        toolCallsForOutput
      );
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
    }

    // Emit inference event (independent of captureMessageContent, per rule)
    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: GoogleAIWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: GoogleAIWrapper.serverPort,
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
      };
      if (responseId) {
        eventAttrs[SemanticConvention.GEN_AI_RESPONSE_ID] = responseId;
      }
      if (finishReason) {
        eventAttrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = [finishReason];
      }
      if (captureContent) {
        if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
        if (outputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
      }
      OpenLitHelper.emitInferenceEvent(span, eventAttrs);
    }

    return {
      genAIEndpoint,
      model: requestModel,
      user: undefined,
      cost,
      aiSystem: GoogleAIWrapper.aiSystem,
    };
  }
}

export default GoogleAIWrapper;
