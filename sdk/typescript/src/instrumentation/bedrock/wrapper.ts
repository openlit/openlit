import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

function mapFinishReason(stopReason: string): string {
  const map: Record<string, string> = {
    end_turn: 'stop',
    max_tokens: 'max_tokens',
    stop_sequence: 'stop',
    tool_use: 'tool_calls',
    content_filtered: 'content_filter',
    guardrail_intervention: 'content_filter',
  };
  return map[stopReason] || stopReason;
}

function spanCreationAttrs(
  operationName: string,
  requestModel: string
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_AWS_BEDROCK,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: BedrockWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: BedrockWrapper.serverPort,
  };
}

/**
 * Convert Bedrock message content blocks ({text: "..."}) to the format
 * expected by OpenLitHelper.buildInputMessages ({type: "text", text: "..."}).
 */
function convertBedrockMessages(messages: any[]): any[] {
  return (messages || []).map((m: any) => {
    const role = m.role || 'user';
    const content = m.content;
    if (!Array.isArray(content)) {
      return { role, content: typeof content === 'string' ? content : '' };
    }
    return {
      role,
      content: content.map((c: any) => {
        if (c.text !== undefined) return { type: 'text', text: c.text };
        if (c.toolUse) {
          return {
            type: 'tool_use',
            id: c.toolUse.toolUseId || '',
            name: c.toolUse.name || '',
            input: c.toolUse.input || {},
          };
        }
        if (c.toolResult) {
          const rc = c.toolResult.content;
          return {
            type: 'tool_result',
            tool_use_id: c.toolResult.toolUseId || '',
            content: typeof rc === 'string' ? rc : JSON.stringify(rc || ''),
          };
        }
        return c;
      }),
    };
  });
}

class BedrockWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_AWS_BEDROCK;
  static serverAddress = 'bedrock-runtime.amazonaws.com';
  static serverPort = 443;

  static _patchSend(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const command = args[0];
        if (!command) return originalMethod.apply(this, args);

        const commandName = command.constructor?.name || '';

        if (commandName === 'ConverseCommand') {
          return BedrockWrapper._handleConverseCommand(tracer, originalMethod, this, args);
        }
        if (commandName === 'ConverseStreamCommand') {
          return BedrockWrapper._handleConverseStreamCommand(tracer, originalMethod, this, args);
        }

        return originalMethod.apply(this, args);
      };
    };
  }

  static async _handleConverseCommand(
    tracer: Tracer,
    originalMethod: any,
    instance: any,
    args: any[]
  ): Promise<any> {
    const command = args[0];
    const input = command.input || {};
    const modelId = input.modelId || 'amazon.titan-text-express-v1';
    const genAIEndpoint = 'bedrock.converse';

    const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${modelId}`;
    const span = tracer.startSpan(spanName, {
      kind: SpanKind.CLIENT,
      attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, modelId),
    });

    return context
      .with(trace.setSpan(context.active(), span), async () => {
        return originalMethod.apply(instance, args);
      })
      .then((response: any) => {
        return BedrockWrapper._converseComplete({ input, genAIEndpoint, response, span, modelId });
      })
      .catch((e: any) => {
        OpenLitHelper.handleException(span, e);
        BaseWrapper.recordMetrics(span, {
          genAIEndpoint,
          model: modelId,
          aiSystem: BedrockWrapper.aiSystem,
          serverAddress: BedrockWrapper.serverAddress,
          serverPort: BedrockWrapper.serverPort,
          errorType: e?.constructor?.name || '_OTHER',
        });
        span.end();
        throw e;
      });
  }

  static async _converseComplete({
    input,
    genAIEndpoint,
    response,
    span,
    modelId,
  }: {
    input: any;
    genAIEndpoint: string;
    response: any;
    span: Span;
    modelId: string;
  }): Promise<any> {
    let metricParams;
    try {
      metricParams = BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint,
        result: response,
        span,
        modelId,
        isStream: false,
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

  static async _handleConverseStreamCommand(
    tracer: Tracer,
    originalMethod: any,
    instance: any,
    args: any[]
  ): Promise<any> {
    const command = args[0];
    const input = command.input || {};
    const modelId = input.modelId || 'amazon.titan-text-express-v1';
    const genAIEndpoint = 'bedrock.converse_stream';
    const startTime = Date.now();

    const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${modelId}`;
    const span = tracer.startSpan(spanName, {
      kind: SpanKind.CLIENT,
      attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, modelId),
    });

    let response: any;
    try {
      response = await context.with(trace.setSpan(context.active(), span), () =>
        originalMethod.apply(instance, args)
      );
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
      BaseWrapper.recordMetrics(span, {
        genAIEndpoint,
        model: modelId,
        aiSystem: BedrockWrapper.aiSystem,
        serverAddress: BedrockWrapper.serverAddress,
        serverPort: BedrockWrapper.serverPort,
        errorType: e?.constructor?.name || '_OTHER',
      });
      span.end();
      throw e;
    }

    let llmResponse = '';
    let finishReason = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    const timestamps: number[] = [];

    const originalStream: AsyncIterable<any> = response.stream;

    async function* wrappedStream() {
      try {
        for await (const event of originalStream) {
          timestamps.push(Date.now());

          if (event.contentBlockDelta?.delta?.text)
            llmResponse += event.contentBlockDelta.delta.text;
          if (event.messageStop?.stopReason)
            finishReason = mapFinishReason(event.messageStop.stopReason);
          if (event.metadata?.usage) {
            inputTokens = event.metadata.usage.inputTokens || 0;
            outputTokens = event.metadata.usage.outputTokens || 0;
            cacheReadTokens = event.metadata.usage.cacheReadInputTokens || 0;
            cacheWriteTokens = event.metadata.usage.cacheWriteInputTokens || 0;
          }

          yield event;
        }
      } finally {
        try {
          const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
          let tbt = 0;
          if (timestamps.length > 1) {
            const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
            tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
          }

          const result = {
            output: { message: { content: [{ text: llmResponse }] } },
            stopReason: finishReason,
            usage: {
              inputTokens,
              outputTokens,
              cacheReadInputTokens: cacheReadTokens,
              cacheWriteInputTokens: cacheWriteTokens,
            },
            $metadata: response.$metadata,
          };

          const metricParams = BedrockWrapper._converseCommonSetter({
            input,
            genAIEndpoint,
            result,
            span,
            modelId,
            isStream: true,
            ttft,
            tbt,
          });

          BaseWrapper.recordMetrics(span, metricParams);
        } catch { /* ignore telemetry errors in finally */ } finally {
          span.end();
        }
      }
    }

    return { ...response, stream: wrappedStream() };
  }

  static _converseCommonSetter({
    input,
    genAIEndpoint,
    result,
    span,
    modelId,
    isStream,
    ttft = 0,
    tbt = 0,
  }: {
    input: any;
    genAIEndpoint: string;
    result: any;
    span: Span;
    modelId: string;
    isStream: boolean;
    ttft?: number;
    tbt?: number;
  }): BaseSpanAttributes {
    const captureContent = OpenlitConfig.captureMessageContent;
    const inferenceConfig = input.inferenceConfig || {};

    if (inferenceConfig.temperature !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, inferenceConfig.temperature);
    }
    if (inferenceConfig.topP !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, inferenceConfig.topP);
    }
    if (inferenceConfig.topK !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, inferenceConfig.topK);
    }
    if (inferenceConfig.maxTokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, inferenceConfig.maxTokens);
    }
    if (inferenceConfig.stopSequences) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, inferenceConfig.stopSequences);
    }
    if (inferenceConfig.frequencyPenalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, inferenceConfig.frequencyPenalty);
    }
    if (inferenceConfig.presencePenalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, inferenceConfig.presencePenalty);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, isStream);

    const usage = result.usage || {};
    const inputTokens = usage.inputTokens || 0;
    const outputTokens = usage.outputTokens || 0;
    const cacheReadTokens = usage.cacheReadInputTokens || 0;
    const cacheWriteTokens = usage.cacheWriteInputTokens || 0;

    const responseModel = modelId;
    const finishReason = mapFinishReason(result.stopReason || 'stop');

    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getChatModelCost(modelId, pricingInfo, inputTokens, outputTokens);

    BedrockWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: modelId,
      cost,
      aiSystem: BedrockWrapper.aiSystem,
      serverAddress: BedrockWrapper.serverAddress,
      serverPort: BedrockWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);

    const requestId = result.$metadata?.requestId;
    if (requestId) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, requestId);
    }

    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);

    if (cacheReadTokens > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheReadTokens);
    }
    if (cacheWriteTokens > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheWriteTokens);
    }

    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);

    const outputText =
      result.output?.message?.content?.map((c: any) => c.text || '').join('') || '';
    const outputType = typeof outputText === 'string'
      ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    const contentBlocks = result.output?.message?.content || [];
    const toolCalls = contentBlocks
      .filter((c: any) => c.toolUse)
      .map((c: any) => ({
        id: c.toolUse.toolUseId || '',
        name: c.toolUse.name || '',
        arguments: c.toolUse.input || {},
      }));

    if (toolCalls.length > 0) {
      const toolNames = toolCalls.map((t: any) => t.name).filter(Boolean);
      const toolIds = toolCalls.map((t: any) => t.id).filter(Boolean);
      const toolArgs = toolCalls
        .map((t: any) => (typeof t.arguments === 'string' ? t.arguments : JSON.stringify(t.arguments)))
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

    const messages = convertBedrockMessages(input.messages || []);
    const systemBlock = input.system || [];
    const systemParts: any[] = [];
    if (Array.isArray(systemBlock)) {
      for (const item of systemBlock) {
        if (item?.text) {
          systemParts.push({ type: 'text', content: item.text });
        }
      }
    }

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;

    if (captureContent) {
      inputMessagesJson = OpenLitHelper.buildInputMessages(messages);
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);

      if (systemParts.length > 0) {
        span.setAttribute(
          SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
          JSON.stringify(systemParts)
        );
      }

      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        outputText,
        finishReason,
        toolCalls.length > 0 ? toolCalls : undefined
      );
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: modelId,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: BedrockWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: BedrockWrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason],
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
      };
      if (requestId) {
        eventAttrs[SemanticConvention.GEN_AI_RESPONSE_ID] = requestId;
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
      aiSystem: BedrockWrapper.aiSystem,
    };
  }
}

export default BedrockWrapper;
