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
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: HuggingFaceWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: HuggingFaceWrapper.serverPort,
  };
}

class HuggingFaceWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE;
  static serverAddress = 'api-inference.huggingface.co';
  static serverPort = 443;

  static _patchChatCompletion(tracer: Tracer): any {
    const genAIEndpoint = 'huggingface.chat.completions';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const requestModel = args[0]?.model || 'mistralai/Mistral-7B-Instruct-v0.1';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, requestModel),
        });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            const { stream = false } = args[0] || {};
            if (stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                HuggingFaceWrapper._chatCompletionGenerator({ args, genAIEndpoint, response, span })
              );
            }
            return HuggingFaceWrapper._chatCompletion({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: HuggingFaceWrapper.aiSystem,
              serverAddress: HuggingFaceWrapper.serverAddress,
              serverPort: HuggingFaceWrapper.serverPort,
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
      metricParams = await HuggingFaceWrapper._chatCompletionCommonSetter({
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
      const { messages } = args[0] || {};
      let { tools } = args[0] || {};
      const result = {
        id: '',
        created: -1,
        model: args[0]?.model || '',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '' },
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };

      let toolCalls: any[] = [];

      for await (const chunk of response) {
        timestamps.push(Date.now());
        if (chunk.id) result.id = chunk.id;
        if (chunk.created) result.created = chunk.created;
        if (chunk.model) result.model = chunk.model;
        if (chunk.choices?.[0]?.finish_reason) {
          result.choices[0].finish_reason = chunk.choices[0].finish_reason;
        }
        if (chunk.choices?.[0]?.delta?.content) {
          result.choices[0].message.content += chunk.choices[0].delta.content;
        }

        if (chunk.choices?.[0]?.delta?.tool_calls) {
          const deltaTools = chunk.choices[0].delta.tool_calls;
          for (const tool of deltaTools) {
            const idx = tool.index || 0;
            while (toolCalls.length <= idx) {
              toolCalls.push({
                id: '',
                type: 'function',
                function: { name: '', arguments: '' },
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

        yield chunk;
      }

      if (toolCalls.length > 0) {
        result.choices[0].message = {
          ...result.choices[0].message,
          tool_calls: toolCalls,
        } as any;
      }

      let promptTokens = 0;
      for (const message of messages || []) {
        promptTokens += OpenLitHelper.generalTokens(message.content as string) ?? 0;
      }
      const completionTokens = OpenLitHelper.generalTokens(result.choices[0].message.content ?? '');
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

      metricParams = await HuggingFaceWrapper._chatCompletionCommonSetter({
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
    const requestModel = args[0]?.model || 'mistralai/Mistral-7B-Instruct-v0.1';
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
      stream = false,
      tools,
    } = args[0] || {};

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

    const responseModel = result.model || requestModel;

    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getChatModelCost(
      requestModel,
      pricingInfo,
      result.usage?.prompt_tokens || 0,
      result.usage?.completion_tokens || 0
    );

    HuggingFaceWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      cost,
      aiSystem: HuggingFaceWrapper.aiSystem,
      serverAddress: HuggingFaceWrapper.serverAddress,
      serverPort: HuggingFaceWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);

    const inputTokens = result.usage?.prompt_tokens || 0;
    const outputTokens = result.usage?.completion_tokens || 0;
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);

    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    if (result.choices?.[0]?.finish_reason) {
      span.setAttribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        [result.choices[0].finish_reason]
      );
    }

    const outputType = typeof result.choices?.[0]?.message?.content === 'string'
      ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    if (result.choices?.[0]?.message?.tool_calls) {
      const tc = result.choices[0].message.tool_calls;
      const toolNames = tc.map((t: any) => t.function?.name || '').filter(Boolean);
      const toolIds = tc.map((t: any) => t.id || '').filter(Boolean);
      const toolArgs = tc.map((t: any) => t.function?.arguments || '').filter(Boolean);
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
      const toolCalls = result.choices?.[0]?.message?.tool_calls;
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        result.choices?.[0]?.message?.content || '',
        result.choices?.[0]?.finish_reason || 'stop',
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
        [SemanticConvention.SERVER_ADDRESS]: HuggingFaceWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: HuggingFaceWrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: result.id,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [result.choices?.[0]?.finish_reason],
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
      aiSystem: HuggingFaceWrapper.aiSystem,
    };
  }

  // ── Text Generation ──────────────────────────────────────────────────────────

  static _patchTextGeneration(tracer: Tracer): any {
    const genAIEndpoint = 'huggingface.text.generation';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const requestModel = args[0]?.model || 'gpt2';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION} ${requestModel}`;
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, requestModel),
        });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) =>
            HuggingFaceWrapper._textGeneration({ args, genAIEndpoint, response, span })
          )
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: HuggingFaceWrapper.aiSystem,
              serverAddress: HuggingFaceWrapper.serverAddress,
              serverPort: HuggingFaceWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static async _textGeneration({
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
      const captureContent = OpenlitConfig.captureMessageContent;
      const { model = '', inputs = '', parameters = {} } = args[0] || {};
      const { max_new_tokens = null, temperature = 1, top_p } = parameters;

      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p || 1);
      if (max_new_tokens != null) {
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_new_tokens);
      }
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

      const generatedText: string = response?.generated_text || '';
      const promptTokens = OpenLitHelper.generalTokens(inputs) ?? 0;
      const completionTokens = OpenLitHelper.generalTokens(generatedText) ?? 0;

      const responseModel = model;
      const pricingInfo = OpenlitConfig.pricingInfo || {};
      const cost = OpenLitHelper.getChatModelCost(model, pricingInfo, promptTokens, completionTokens);

      HuggingFaceWrapper.setBaseSpanAttributes(span, {
        genAIEndpoint,
        model,
        cost,
        aiSystem: HuggingFaceWrapper.aiSystem,
        serverAddress: HuggingFaceWrapper.serverAddress,
        serverPort: HuggingFaceWrapper.serverPort,
      });

      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);

      let inputMessagesJson: string | undefined;
      let outputMessagesJson: string | undefined;
      if (captureContent) {
        inputMessagesJson = OpenLitHelper.buildInputMessages([{ role: 'user', content: inputs }]);
        span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
        outputMessagesJson = OpenLitHelper.buildOutputMessages(generatedText, 'stop');
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      }

      if (!OpenlitConfig.disableEvents) {
        const eventAttrs: Attributes = {
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: model,
          [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
          [SemanticConvention.SERVER_ADDRESS]: HuggingFaceWrapper.serverAddress,
          [SemanticConvention.SERVER_PORT]: HuggingFaceWrapper.serverPort,
          [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: ['stop'],
          [SemanticConvention.GEN_AI_OUTPUT_TYPE]: SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: promptTokens,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: completionTokens,
        };
        if (captureContent) {
          if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
          if (outputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
        }
        OpenLitHelper.emitInferenceEvent(span, eventAttrs);
      }

      metricParams = { genAIEndpoint, model, cost, aiSystem: HuggingFaceWrapper.aiSystem };
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
}

export default HuggingFaceWrapper;
