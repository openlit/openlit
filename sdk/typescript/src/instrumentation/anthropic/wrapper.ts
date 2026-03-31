import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

const FINISH_REASON_MAP: Record<string, string> = {
  end_turn: 'stop',
  max_tokens: 'length',
  stop_sequence: 'stop',
  tool_use: 'tool_call',
};

function mapFinishReason(reason: string): string {
  return FINISH_REASON_MAP[reason] || reason || 'stop';
}

function spanCreationAttrs(
  operationName: string,
  requestModel: string
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: AnthropicWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: AnthropicWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: AnthropicWrapper.serverPort,
  };
}

export default class AnthropicWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC;
  static serverAddress = 'api.anthropic.com';
  static serverPort = 443;

  static _patchMessageCreate(tracer: Tracer): any {
    const genAIEndpoint = 'anthropic.resources.messages';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const requestModel = args[0]?.model || 'claude-3-5-sonnet-latest';
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
            const { stream = false } = args[0];

            if (stream) {
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
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: AnthropicWrapper.aiSystem,
              serverAddress: AnthropicWrapper.serverAddress,
              serverPort: AnthropicWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
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
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
  }): Promise<any> {
    let metricParams;
    try {
      metricParams = await AnthropicWrapper._messageCreateCommonSetter({
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
  }): AsyncGenerator<unknown, any, unknown> {
    let metricParams;
    const timestamps: number[] = [];
    const startTime = Date.now();

    try {
      const result = {
        id: '',
        model: '',
        stop_reason: '',
        content: [] as any[],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      };

      let llmResponse = '';
      let toolId = '';
      let toolName = '';
      let toolArguments = '';

      for await (const chunk of response) {
        timestamps.push(Date.now());

        switch (chunk.type) {
          case 'message_start':
            if (chunk.message) {
              result.id = chunk.message.id;
              result.model = chunk.message.model;
              result.usage.input_tokens = Number(chunk.message.usage?.input_tokens) || 0;
              result.usage.output_tokens += Number(chunk.message.usage?.output_tokens) || 0;
              result.usage.cache_creation_input_tokens =
                Number(chunk.message.usage?.cache_creation_input_tokens) || 0;
              result.usage.cache_read_input_tokens =
                Number(chunk.message.usage?.cache_read_input_tokens) || 0;
              result.stop_reason = chunk.message.stop_reason || '';
            }
            break;

          case 'content_block_start':
            if (chunk.content_block?.type === 'tool_use') {
              toolId = chunk.content_block.id || '';
              toolName = chunk.content_block.name || '';
              toolArguments = '';
            }
            break;

          case 'content_block_delta':
            if (chunk.delta?.text) {
              llmResponse += chunk.delta.text;
            }
            if (chunk.delta?.partial_json) {
              toolArguments += chunk.delta.partial_json;
            }
            break;

          case 'content_block_stop':
            break;

          case 'message_delta':
            result.stop_reason = chunk.delta?.stop_reason || result.stop_reason;
            result.usage.output_tokens += Number(chunk.usage?.output_tokens) || 0;
            if (chunk.usage?.cache_creation_input_tokens != null) {
              result.usage.cache_creation_input_tokens =
                Number(chunk.usage.cache_creation_input_tokens) || 0;
            }
            if (chunk.usage?.cache_read_input_tokens != null) {
              result.usage.cache_read_input_tokens =
                Number(chunk.usage.cache_read_input_tokens) || 0;
            }
            break;

          case 'message_stop':
            break;
        }

        yield chunk;
      }

      if (llmResponse) {
        result.content.push({ type: 'text', text: llmResponse });
      }
      if (toolId) {
        let parsedInput = {};
        try { parsedInput = JSON.parse(toolArguments); } catch { /* keep empty */ }
        result.content.push({
          type: 'tool_use',
          id: toolId,
          name: toolName,
          input: parsedInput,
        });
      }

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await AnthropicWrapper._messageCreateCommonSetter({
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

  static async _messageCreateCommonSetter({
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
    const requestModel = args[0]?.model || 'claude-3-5-sonnet-latest';
    const {
      messages,
      system,
      max_tokens = null,
      seed = null,
      temperature = 1,
      top_p,
      top_k,
      stop_sequences = null,
      stream = false,
      user,
    } = args[0];

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p || 1);
    if (top_k != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, top_k);
    }
    if (max_tokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);
    if (seed != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, Number(seed));
    }
    if (stop_sequences && Array.isArray(stop_sequences) && stop_sequences.length > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, stop_sequences);
    }

    if (captureContent) {
      const systemStr = typeof system === 'string' ? system : undefined;
      span.setAttribute(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        OpenLitHelper.buildInputMessages(messages || [], systemStr)
      );
      if (system) {
        const sysAttr = typeof system === 'string' ? system : JSON.stringify(system);
        span.setAttribute(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS, sysAttr);
      }
    }

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);

    const responseModel = result.model || requestModel;

    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getChatModelCost(
      requestModel,
      pricingInfo,
      result.usage.input_tokens,
      result.usage.output_tokens
    );

    AnthropicWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user,
      cost,
      aiSystem: AnthropicWrapper.aiSystem,
      serverAddress: AnthropicWrapper.serverAddress,
      serverPort: AnthropicWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);

    const inputTokens = result.usage.input_tokens;
    const outputTokens = result.usage.output_tokens;
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);

    if (result.usage.cache_creation_input_tokens) {
      span.setAttribute(
        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        result.usage.cache_creation_input_tokens
      );
    }
    if (result.usage.cache_read_input_tokens) {
      span.setAttribute(
        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        result.usage.cache_read_input_tokens
      );
    }

    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    const finishReason = mapFinishReason(result.stop_reason);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);

    const toolUseBlocks = (result.content || []).filter((b: any) => b.type === 'tool_use');
    const outputType = toolUseBlocks.length > 0
      ? SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON
      : SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    if (toolUseBlocks.length > 0) {
      const toolNames = toolUseBlocks.map((b: any) => b.name || '').filter(Boolean);
      const toolIds = toolUseBlocks.map((b: any) => b.id || '').filter(Boolean);
      const toolArgs = toolUseBlocks.map((b: any) => JSON.stringify(b.input || {}));
      if (toolNames.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, toolNames.join(', '));
      if (toolIds.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, toolIds.join(', '));
      if (toolArgs.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, toolArgs);
    }

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;
    if (captureContent) {
      const textContent = (result.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text || '')
        .join('');
      const toolCallsForOutput = toolUseBlocks.length > 0
        ? toolUseBlocks.map((b: any) => ({
            id: b.id || '',
            name: b.name || '',
            arguments: b.input || {},
          }))
        : undefined;
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        textContent,
        finishReason,
        toolCallsForOutput
      );
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      const systemStr = typeof system === 'string' ? system : undefined;
      inputMessagesJson = OpenLitHelper.buildInputMessages(messages || [], systemStr);
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: AnthropicWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: AnthropicWrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: result.id,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason],
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
      aiSystem: AnthropicWrapper.aiSystem,
    };
  }
}
