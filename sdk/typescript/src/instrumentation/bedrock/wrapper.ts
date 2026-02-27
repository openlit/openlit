import { SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

const BEDROCK_SERVER_ADDRESS = 'bedrock-runtime.amazonaws.com';
const BEDROCK_SERVER_PORT = 443;

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

function applyInferenceConfigAttributes(span: any, inferenceConfig: any) {
  if (inferenceConfig.maxTokens !== undefined)
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, inferenceConfig.maxTokens);
  if (inferenceConfig.temperature !== undefined)
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, inferenceConfig.temperature);
  if (inferenceConfig.topP !== undefined)
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, inferenceConfig.topP);
  if (inferenceConfig.topK !== undefined)
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, inferenceConfig.topK);
  if (inferenceConfig.stopSequences !== undefined)
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, inferenceConfig.stopSequences);
}

class BedrockWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_AWS_BEDROCK;

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
        if (commandName === 'InvokeModelCommand' || commandName === 'InvokeModelWithResponseStreamCommand') {
          return BedrockWrapper._handleInvokeModelCommand(tracer, originalMethod, this, args, commandName);
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
    const modelId = input.modelId || 'unknown';
    const genAIEndpoint = 'bedrock.converse';

    const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
    return context.with(trace.setSpan(context.active(), span), async () => {
      const startTime = Date.now();
      let metricParams: BaseSpanAttributes | undefined;
      try {
        const response = await originalMethod.apply(instance, args);
        const duration = (Date.now() - startTime) / 1000;

        const usage = response.usage || {};
        const promptTokens = usage.inputTokens || 0;
        const completionTokens = usage.outputTokens || 0;
        const totalTokens = usage.totalTokens || promptTokens + completionTokens;
        const cacheReadTokens = usage.cacheReadInputTokens || 0;
        const cacheWriteTokens = usage.cacheWriteInputTokens || 0;

        const finishReason = mapFinishReason(response.stopReason || 'stop');

        const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
        const cost = OpenLitHelper.getChatModelCost(modelId, pricingInfo, promptTokens, completionTokens);

        BedrockWrapper.setBaseSpanAttributes(span, {
          genAIEndpoint,
          model: modelId,
          cost,
          aiSystem: BedrockWrapper.aiSystem,
          serverAddress: BEDROCK_SERVER_ADDRESS,
          serverPort: BEDROCK_SERVER_PORT,
        });

        span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, modelId);
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);
        span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, totalTokens);
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
        span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
        span.setAttribute(SemanticConvention.SERVER_ADDRESS, BEDROCK_SERVER_ADDRESS);
        span.setAttribute(SemanticConvention.SERVER_PORT, BEDROCK_SERVER_PORT);

        if (cacheReadTokens > 0)
          span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheReadTokens);
        if (cacheWriteTokens > 0)
          span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheWriteTokens);

        const requestId = response.$metadata?.requestId;
        if (requestId)
          span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, requestId);

        applyInferenceConfigAttributes(span, input.inferenceConfig || {});

        if (OpenlitConfig.traceContent) {
          const messages = (input.messages || []).map((m: any) => ({
            role: m.role,
            content: m.content?.map((c: any) => c.text || '').join('') || '',
          }));
          const systemText = input.system?.[0]?.text;
          span.setAttribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES,
            OpenLitHelper.buildInputMessages(messages, systemText)
          );
          if (systemText) {
            span.setAttribute(
              SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
              JSON.stringify([{ type: 'text', content: systemText }])
            );
          }
          const outputText =
            response.output?.message?.content?.map((c: any) => c.text || '').join('') || '';
          span.setAttribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
            OpenLitHelper.buildOutputMessages(outputText, finishReason)
          );
        }

        metricParams = { genAIEndpoint, model: modelId, cost, aiSystem: BedrockWrapper.aiSystem };
        return response;
      } catch (e: any) {
        OpenLitHelper.handleException(span, e);
        throw e;
      } finally {
        span.end();
        if (metricParams) BaseWrapper.recordMetrics(span, metricParams);
      }
    });
  }

  static async _handleConverseStreamCommand(
    tracer: Tracer,
    originalMethod: any,
    instance: any,
    args: any[]
  ): Promise<any> {
    const command = args[0];
    const input = command.input || {};
    const modelId = input.modelId || 'unknown';
    const genAIEndpoint = 'bedrock.converse_stream';
    const startTime = Date.now();

    const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });

    // Call the original method to get the response object (with .stream async iterable)
    const response = await context.with(trace.setSpan(context.active(), span), () =>
      originalMethod.apply(instance, args)
    );

    // Accumulated state from stream events
    let llmResponse = '';
    let finishReason = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let firstChunkTime: number | null = null;
    const chunkTimestamps: number[] = [];

    const originalStream: AsyncIterable<any> = response.stream;

    async function* wrappedStream() {
      try {
        for await (const event of originalStream) {
          const now = Date.now();
          if (firstChunkTime === null) firstChunkTime = now;
          chunkTimestamps.push(now);

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
        // Record telemetry once the stream is fully consumed
        try {
          const duration = (Date.now() - startTime) / 1000;
          const ttft = firstChunkTime !== null ? (firstChunkTime - startTime) / 1000 : 0;
          let tbt = 0;
          if (chunkTimestamps.length > 1) {
            const timeDiffs = chunkTimestamps.slice(1).map((t, i) => t - chunkTimestamps[i]);
            tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
          }
          const totalTokens = inputTokens + outputTokens;

          const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
          const cost = OpenLitHelper.getChatModelCost(modelId, pricingInfo, inputTokens, outputTokens);

          BedrockWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: modelId,
            cost,
            aiSystem: BedrockWrapper.aiSystem,
          });

          span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);
          span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, modelId);
          span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
          span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
          span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);
          span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, totalTokens);
          span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
          span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
          span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
          if (ttft > 0) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
          if (tbt > 0) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
          span.setAttribute(SemanticConvention.SERVER_ADDRESS, BEDROCK_SERVER_ADDRESS);
          span.setAttribute(SemanticConvention.SERVER_PORT, BEDROCK_SERVER_PORT);

          if (cacheReadTokens > 0)
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheReadTokens);
          if (cacheWriteTokens > 0)
            span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheWriteTokens);

          const requestId = response.$metadata?.requestId;
          if (requestId)
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, requestId);

          applyInferenceConfigAttributes(span, input.inferenceConfig || {});

          if (OpenlitConfig.traceContent) {
            const messages = (input.messages || []).map((m: any) => ({
              role: m.role,
              content: m.content?.map((c: any) => c.text || '').join('') || '',
            }));
            const systemText = input.system?.[0]?.text;
            span.setAttribute(
              SemanticConvention.GEN_AI_INPUT_MESSAGES,
              OpenLitHelper.buildInputMessages(messages, systemText)
            );
            if (systemText) {
              span.setAttribute(
                SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                JSON.stringify([{ type: 'text', content: systemText }])
              );
            }
            span.setAttribute(
              SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
              OpenLitHelper.buildOutputMessages(llmResponse, finishReason)
            );
          }

          const metricParams: BaseSpanAttributes = { genAIEndpoint, model: modelId, cost, aiSystem: BedrockWrapper.aiSystem };
          BaseWrapper.recordMetrics(span, metricParams);
        } catch { /* ignore telemetry errors in finally */ } finally {
          span.end();
        }
      }
    }

    return { ...response, stream: wrappedStream() };
  }

  static async _handleInvokeModelCommand(
    tracer: Tracer,
    originalMethod: any,
    instance: any,
    args: any[],
    commandName: string
  ): Promise<any> {
    const command = args[0];
    const input = command.input || {};
    const modelId = input.modelId || 'unknown';
    const isStream = commandName === 'InvokeModelWithResponseStreamCommand';
    const genAIEndpoint = isStream ? 'bedrock.invoke_model_stream' : 'bedrock.invoke_model';

    const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
    return context.with(trace.setSpan(context.active(), span), async () => {
      const startTime = Date.now();
      let metricParams: BaseSpanAttributes | undefined;
      try {
        const response = await originalMethod.apply(instance, args);
        const duration = (Date.now() - startTime) / 1000;

        // Parse response body
        let parsedBody: any = {};
        let promptTokens = 0;
        let completionTokens = 0;
        let outputText = '';
        let rawFinishReason = 'stop';

        try {
          const bodyBytes = response.body;
          if (bodyBytes) {
            const bodyStr = typeof bodyBytes === 'string'
              ? bodyBytes
              : Buffer.from(bodyBytes).toString('utf-8');
            parsedBody = JSON.parse(bodyStr);
          }
        } catch { /* ignore parse errors */ }

        // Handle different provider response formats
        if (modelId.startsWith('anthropic')) {
          promptTokens = parsedBody.usage?.input_tokens || 0;
          completionTokens = parsedBody.usage?.output_tokens || 0;
          outputText = parsedBody.content?.[0]?.text || '';
          rawFinishReason = parsedBody.stop_reason || 'stop';
        } else if (modelId.startsWith('amazon')) {
          promptTokens = parsedBody.inputTextTokenCount || 0;
          completionTokens = parsedBody.results?.[0]?.tokenCount || 0;
          outputText = parsedBody.results?.[0]?.outputText || '';
          rawFinishReason = parsedBody.results?.[0]?.completionReason || 'stop';
        } else if (modelId.startsWith('meta')) {
          promptTokens = parsedBody.prompt_token_count || 0;
          completionTokens = parsedBody.generation_token_count || 0;
          outputText = parsedBody.generation || '';
          rawFinishReason = parsedBody.stop_reason || 'stop';
        } else if (modelId.startsWith('mistral') || modelId.startsWith('mixtral')) {
          promptTokens = parsedBody.usage?.prompt_tokens || 0;
          completionTokens = parsedBody.usage?.completion_tokens || 0;
          outputText = parsedBody.outputs?.[0]?.text || '';
          rawFinishReason = parsedBody.outputs?.[0]?.stop_reason || 'stop';
        } else if (modelId.startsWith('ai21')) {
          promptTokens = parsedBody.prompt?.tokens?.length || 0;
          completionTokens = parsedBody.completions?.[0]?.data?.tokens?.length || 0;
          outputText = parsedBody.completions?.[0]?.data?.text || '';
          rawFinishReason = parsedBody.completions?.[0]?.finishReason?.reason || 'stop';
        } else {
          outputText = parsedBody.output || parsedBody.generation || parsedBody.text || '';
        }

        const finishReason = mapFinishReason(rawFinishReason);
        const totalTokens = promptTokens + completionTokens;
        const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
        const cost = OpenLitHelper.getChatModelCost(modelId, pricingInfo, promptTokens, completionTokens);

        BedrockWrapper.setBaseSpanAttributes(span, {
          genAIEndpoint,
          model: modelId,
          cost,
          aiSystem: BedrockWrapper.aiSystem,
          serverAddress: BEDROCK_SERVER_ADDRESS,
          serverPort: BEDROCK_SERVER_PORT,
        });

        span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, isStream);
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, modelId);
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);
        span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, totalTokens);
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
        span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
        span.setAttribute(SemanticConvention.SERVER_ADDRESS, BEDROCK_SERVER_ADDRESS);
        span.setAttribute(SemanticConvention.SERVER_PORT, BEDROCK_SERVER_PORT);

        const requestId = response.$metadata?.requestId;
        if (requestId)
          span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, requestId);

        if (OpenlitConfig.traceContent) {
          try {
            const reqBody = input.body
              ? JSON.parse(typeof input.body === 'string' ? input.body : Buffer.from(input.body).toString())
              : {};
            const prompt = reqBody.prompt || reqBody.inputText || '';
            if (prompt) {
              span.setAttribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES,
                OpenLitHelper.buildInputMessages([{ role: 'user', content: prompt }])
              );
            }
          } catch { /* ignore */ }

          if (outputText) {
            span.setAttribute(
              SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
              OpenLitHelper.buildOutputMessages(outputText, finishReason)
            );
          }
        }

        metricParams = { genAIEndpoint, model: modelId, cost, aiSystem: BedrockWrapper.aiSystem };
        return response;
      } catch (e: any) {
        OpenLitHelper.handleException(span, e);
        throw e;
      } finally {
        span.end();
        if (metricParams) BaseWrapper.recordMetrics(span, metricParams);
      }
    });
  }
}

export default BedrockWrapper;
