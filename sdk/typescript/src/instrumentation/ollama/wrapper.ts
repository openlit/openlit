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
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: OllamaWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: OllamaWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: OllamaWrapper.serverPort,
  };
}

export default class OllamaWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_OLLAMA;
  static serverAddress = '127.0.0.1';
  static serverPort = 11434;

  // ──────────────────── Chat ────────────────────

  static _patchChat(tracer: Tracer): any {
    const genAIEndpoint = 'ollama.chat';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'llama3';
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
            const { stream = false } = args[0];
            if (stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                OllamaWrapper._chatGenerator({ args, genAIEndpoint, response, span })
              );
            }
            return OllamaWrapper._chat({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: OllamaWrapper.aiSystem,
              serverAddress: OllamaWrapper.serverAddress,
              serverPort: OllamaWrapper.serverPort,
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
      metricParams = await OllamaWrapper._chatCommonSetter({
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
      const result: any = {
        model: '',
        message: { role: 'assistant', content: '' },
        done_reason: '',
        prompt_eval_count: 0,
        eval_count: 0,
      };
      let toolCalls: any[] = [];

      for await (const chunk of response) {
        timestamps.push(Date.now());
        result.model = chunk.model || result.model;
        if (chunk.message?.content) {
          result.message.content += chunk.message.content;
          result.message.role = chunk.message.role || result.message.role;
        }
        if (chunk.message?.tool_calls) {
          toolCalls = chunk.message.tool_calls;
        }
        if (chunk.done) {
          result.done_reason = chunk.done_reason || '';
          result.prompt_eval_count = chunk.prompt_eval_count || 0;
          result.eval_count = chunk.eval_count || 0;
        }
        yield chunk;
      }

      if (toolCalls.length > 0) {
        result.message.tool_calls = toolCalls;
      }

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await OllamaWrapper._chatCommonSetter({
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

  static async _chatCommonSetter({
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
    const requestModel = args[0]?.model || 'llama3';
    const { messages, stream = false } = args[0];
    const options = args[0]?.options || {};

    if (options.temperature != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, options.temperature);
    }
    if (options.top_p != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, options.top_p);
    }
    if (options.top_k != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, options.top_k);
    }
    if (options.max_tokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, options.max_tokens);
    }
    if (options.repeat_penalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, options.repeat_penalty);
    }
    if (options.seed != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, Number(options.seed));
    }
    if (options.stop) {
      span.setAttribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        Array.isArray(options.stop) ? options.stop : [options.stop]
      );
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);

    if (captureContent) {
      span.setAttribute(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        OpenLitHelper.buildInputMessages(messages || [])
      );
    }

    const responseModel = result.model || requestModel;
    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const inputTokens = result.prompt_eval_count || 0;
    const outputTokens = result.eval_count || 0;
    const cost = OpenLitHelper.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);

    OllamaWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      cost,
      aiSystem: OllamaWrapper.aiSystem,
      serverAddress: OllamaWrapper.serverAddress,
      serverPort: OllamaWrapper.serverPort,
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

    if (result.done_reason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [result.done_reason]);
    }

    const outputType = typeof result.message?.content === 'string'
      ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    if (result.message?.tool_calls) {
      const resultToolCalls = result.message.tool_calls;
      const toolNames = resultToolCalls.map((t: any) => t.function?.name || '').filter(Boolean);
      const toolIds = resultToolCalls.map((t: any) => String(t.id || '')).filter(Boolean);
      const toolArgs = resultToolCalls
        .map((t: any) => String(t.function?.arguments || ''))
        .filter(Boolean);

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
      const toolCalls = result.message?.tool_calls;
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        result.message?.content || '',
        result.done_reason || 'stop',
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
        [SemanticConvention.SERVER_ADDRESS]: OllamaWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: OllamaWrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [result.done_reason || 'stop'],
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
      cost,
      aiSystem: OllamaWrapper.aiSystem,
    };
  }

  // ──────────────────── Generate (text_completion) ────────────────────

  static _patchGenerate(tracer: Tracer): any {
    const genAIEndpoint = 'ollama.generate';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'llama3';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, requestModel),
        }, effectiveCtx);
        return context
          .with(trace.setSpan(effectiveCtx, span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            const { stream = false } = args[0];
            if (stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                OllamaWrapper._generateGenerator({ args, genAIEndpoint, response, span })
              );
            }
            return OllamaWrapper._generate({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: OllamaWrapper.aiSystem,
              serverAddress: OllamaWrapper.serverAddress,
              serverPort: OllamaWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static async _generate({
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
      metricParams = await OllamaWrapper._generateCommonSetter({
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

  static async *_generateGenerator({
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
      const result: any = {
        model: '',
        response: '',
        done_reason: '',
        prompt_eval_count: 0,
        eval_count: 0,
      };

      for await (const chunk of response) {
        timestamps.push(Date.now());
        result.model = chunk.model || result.model;
        if (chunk.response) {
          result.response += chunk.response;
        }
        if (chunk.done) {
          result.done_reason = chunk.done_reason || '';
          result.prompt_eval_count = chunk.prompt_eval_count || 0;
          result.eval_count = chunk.eval_count || 0;
        }
        yield chunk;
      }

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await OllamaWrapper._generateCommonSetter({
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

  static async _generateCommonSetter({
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
    const requestModel = args[0]?.model || 'llama3';
    const { prompt, stream = false } = args[0];
    const options = args[0]?.options || {};

    if (options.temperature != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, options.temperature);
    }
    if (options.top_p != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, options.top_p);
    }
    if (options.top_k != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, options.top_k);
    }
    if (options.max_tokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, options.max_tokens);
    }
    if (options.repeat_penalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, options.repeat_penalty);
    }
    if (options.seed != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, Number(options.seed));
    }
    if (options.stop) {
      span.setAttribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        Array.isArray(options.stop) ? options.stop : [options.stop]
      );
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);

    if (captureContent) {
      const inputMessages = [{ role: 'user', content: prompt || '' }];
      span.setAttribute(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        OpenLitHelper.buildInputMessages(inputMessages)
      );
    }

    const responseModel = result.model || requestModel;
    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const inputTokens = result.prompt_eval_count || 0;
    const outputTokens = result.eval_count || 0;
    const cost = OpenLitHelper.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);

    OllamaWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      cost,
      aiSystem: OllamaWrapper.aiSystem,
      serverAddress: OllamaWrapper.serverAddress,
      serverPort: OllamaWrapper.serverPort,
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

    if (result.done_reason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [result.done_reason]);
    }

    const llmResponse = result.response || '';
    const outputType = typeof llmResponse === 'string'
      ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;
    if (captureContent) {
      const inputMessages = [{ role: 'user', content: prompt || '' }];
      outputMessagesJson = OpenLitHelper.buildOutputMessages(llmResponse, result.done_reason || 'stop');
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      inputMessagesJson = OpenLitHelper.buildInputMessages(inputMessages);
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: OllamaWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: OllamaWrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [result.done_reason || 'stop'],
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
      cost,
      aiSystem: OllamaWrapper.aiSystem,
    };
  }

  // ──────────────────── Embeddings ────────────────────

  static _patchEmbeddings(tracer: Tracer): any {
    const genAIEndpoint = 'ollama.embeddings';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'llama3';
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

            const promptVal = args[0]?.input || args[0]?.prompt || '';
            const promptText = typeof promptVal === 'string' ? promptVal : JSON.stringify(promptVal);
            const inputTokens = OpenLitHelper.generalTokens(promptText);

            const pricingInfo = OpenlitConfig.pricingInfo || {};
            const cost = OpenLitHelper.getEmbedModelCost(requestModel, pricingInfo, inputTokens);

            OllamaWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model: requestModel,
              cost,
              aiSystem: OllamaWrapper.aiSystem,
              serverAddress: OllamaWrapper.serverAddress,
              serverPort: OllamaWrapper.serverPort,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);

            if (captureContent) {
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, promptText);
            }

            metricParams = {
              genAIEndpoint,
              model: requestModel,
              cost,
              aiSystem: OllamaWrapper.aiSystem,
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
