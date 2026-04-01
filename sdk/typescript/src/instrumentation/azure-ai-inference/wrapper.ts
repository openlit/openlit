import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, { isFrameworkLlmActive, getFrameworkParentContext } from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

function spanCreationAttrs(
  operationName: string,
  requestModel: string,
  serverAddress: string,
  serverPort: number
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_AZURE_AI_INFERENCE,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: serverAddress,
    [SemanticConvention.SERVER_PORT]: serverPort,
  };
}

class AzureAIInferenceWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_AZURE_AI_INFERENCE;
  static defaultServerAddress = 'models.github.ai';
  static defaultServerPort = 443;

  /**
   * Extracts server address and port from an endpoint URL string.
   */
  static parseEndpoint(endpoint: string): { serverAddress: string; serverPort: number } {
    let serverAddress = AzureAIInferenceWrapper.defaultServerAddress;
    let serverPort = AzureAIInferenceWrapper.defaultServerPort;
    try {
      const url = new URL(endpoint);
      serverAddress = url.hostname;
      serverPort = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
    } catch { /* use defaults */ }
    return { serverAddress, serverPort };
  }

  // ──────────────────── Chat Completions ────────────────────

  static _patchChatComplete(
    tracer: Tracer,
    serverAddress: string,
    serverPort: number
  ): any {
    const genAIEndpoint = 'az.ai.inference.chat.completions';
    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const body = args[0]?.body || {};
        const requestModel = body.model || 'gpt-4o';
        const isStream = body.stream === true;

        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            requestModel,
            serverAddress,
            serverPort
          ),
        }, effectiveCtx);

        if (isStream) {
          if (args[0]?.body) {
            args[0].body.stream_options = { include_usage: true };
          }
          const pipelineRequest = context.with(
            trace.setSpan(effectiveCtx, span),
            () => originalMethod.apply(this, args)
          );
          const origAsNodeStream = pipelineRequest.asNodeStream?.bind(pipelineRequest);
          if (origAsNodeStream) {
            pipelineRequest.asNodeStream = async function (...streamArgs: any[]) {
              try {
                const streamResp = await origAsNodeStream(...streamArgs);
                const origBody = streamResp.body;
                if (!origBody) {
                  span.end();
                  return streamResp;
                }
                streamResp.body = AzureAIInferenceWrapper._wrapSseStream(
                  origBody,
                  body,
                  genAIEndpoint,
                  span,
                  serverAddress,
                  serverPort
                );
                return streamResp;
              } catch (e: any) {
                OpenLitHelper.handleException(span, e);
                BaseWrapper.recordMetrics(span, {
                  genAIEndpoint,
                  model: requestModel,
                  aiSystem: AzureAIInferenceWrapper.aiSystem,
                  serverAddress,
                  serverPort,
                  errorType: e?.constructor?.name || '_OTHER',
                });
                span.end();
                throw e;
              }
            };
          }
          return pipelineRequest;
        }

        return context
          .with(trace.setSpan(effectiveCtx, span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((httpResponse: any) => {
            return AzureAIInferenceWrapper._chatCompletion({
              body,
              genAIEndpoint,
              httpResponse,
              span,
              serverAddress,
              serverPort,
            });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: AzureAIInferenceWrapper.aiSystem,
              serverAddress,
              serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static async _chatCompletion({
    body,
    genAIEndpoint,
    httpResponse,
    span,
    serverAddress,
    serverPort,
  }: {
    body: any;
    genAIEndpoint: string;
    httpResponse: any;
    span: Span;
    serverAddress: string;
    serverPort: number;
  }): Promise<any> {
    let metricParams;
    try {
      const result = httpResponse?.body ?? httpResponse;
      if (result && typeof result === 'object' && result.choices) {
        metricParams = AzureAIInferenceWrapper._chatCompletionCommonSetter({
          body,
          genAIEndpoint,
          result,
          span,
          serverAddress,
          serverPort,
        });
      }
      return httpResponse;
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

  /**
   * Wraps an SSE body stream (Node.js IncomingMessage / ReadableStream) to
   * aggregate telemetry while passing through chunks to the caller.
   * Returns an async-iterable that yields the raw SSE buffers/strings so
   * downstream consumers (e.g. createSseStream) keep working.
   */
  static _wrapSseStream(
    body: any,
    requestBody: any,
    genAIEndpoint: string,
    span: Span,
    serverAddress: string,
    serverPort: number
  ): any {
    const requestModel = requestBody.model || 'gpt-4o';
    const startTime = Date.now();
    const timestamps: number[] = [];

    const aggregated = {
      id: '',
      model: '',
      content: '',
      finishReason: 'stop',
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: [] as any[],
    };

    function processSseLine(line: string) {
      if (!line.startsWith('data: ')) return;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        if (parsed.id) aggregated.id = parsed.id;
        if (parsed.model) aggregated.model = parsed.model;
        const choice = parsed.choices?.[0];
        if (choice) {
          if (choice.delta?.content) aggregated.content += choice.delta.content;
          if (choice.finish_reason) aggregated.finishReason = choice.finish_reason;
          if (choice.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              const idx = tc.index ?? 0;
              while (aggregated.toolCalls.length <= idx) {
                aggregated.toolCalls.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
              }
              if (tc.id) {
                aggregated.toolCalls[idx].id = tc.id;
                aggregated.toolCalls[idx].type = tc.type || 'function';
                if (tc.function?.name) aggregated.toolCalls[idx].function.name = tc.function.name;
                if (tc.function?.arguments) aggregated.toolCalls[idx].function.arguments = tc.function.arguments;
              } else if (tc.function?.arguments) {
                aggregated.toolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          }
        }
        if (parsed.usage) {
          aggregated.inputTokens = parsed.usage.prompt_tokens ?? 0;
          aggregated.outputTokens = parsed.usage.completion_tokens ?? 0;
        }
      } catch { /* ignore parse errors */ }
    }

    let pending = '';

    const readable = body;
    const originalPipe = readable.pipe?.bind(readable);
    const originalOn = readable.on?.bind(readable);

    const self = AzureAIInferenceWrapper;
    let finalized = false;

    function finalize() {
      if (finalized) return;
      finalized = true;
      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const diffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = diffs.reduce((a, b) => a + b, 0) / diffs.length / 1000;
      }

      let inputTokens = aggregated.inputTokens;
      let outputTokens = aggregated.outputTokens;
      if (!inputTokens && !outputTokens) {
        const prompt = JSON.stringify(requestBody.messages || []);
        inputTokens = Math.ceil(prompt.length / 2);
        outputTokens = Math.ceil(aggregated.content.length / 2);
      }

      const result = {
        id: aggregated.id,
        model: aggregated.model || requestModel,
        choices: [{
          finish_reason: aggregated.finishReason,
          message: {
            role: 'assistant',
            content: aggregated.content,
            ...(aggregated.toolCalls.length > 0 ? { tool_calls: aggregated.toolCalls } : {}),
          },
        }],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
        },
      };

      const metricParams = self._chatCompletionCommonSetter({
        body: requestBody,
        genAIEndpoint,
        result,
        span,
        serverAddress,
        serverPort,
        ttft,
        tbt,
      });
      span.end();
      BaseWrapper.recordMetrics(span, metricParams);
    }

    if (typeof readable.on === 'function') {
      readable.on('data', (chunk: Buffer | string) => {
        timestamps.push(Date.now());
        const text = typeof chunk === 'string' ? chunk : chunk.toString();
        pending += text;
        const lines = pending.split('\n');
        pending = lines.pop() || '';
        for (const line of lines) {
          processSseLine(line.trim());
        }
      });
      readable.on('end', () => {
        if (pending.trim()) processSseLine(pending.trim());
        finalize();
      });
      readable.on('close', () => {
        if (pending.trim()) processSseLine(pending.trim());
        finalize();
      });
      readable.on('error', (err: Error) => {
        OpenLitHelper.handleException(span, err);
        finalize();
      });
    }

    return readable;
  }

  static _chatCompletionCommonSetter({
    body,
    genAIEndpoint,
    result,
    span,
    serverAddress,
    serverPort,
    ttft = 0,
    tbt = 0,
  }: {
    body: any;
    genAIEndpoint: string;
    result: any;
    span: Span;
    serverAddress: string;
    serverPort: number;
    ttft?: number;
    tbt?: number;
  }): BaseSpanAttributes {
    const captureContent = OpenlitConfig.captureMessageContent;
    const requestModel = body.model || 'gpt-4o';
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
    } = body;

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
      span.setAttribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        Array.isArray(stop) ? stop : [stop]
      );
    }
    if (n && n !== 1) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, n);
    }

    if (captureContent) {
      span.setAttribute(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        OpenLitHelper.buildInputMessages(messages || [])
      );
    }

    if (result.id) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);
    }

    const responseModel = result.model || requestModel;
    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const inputTokens = result.usage?.prompt_tokens || 0;
    const outputTokens = result.usage?.completion_tokens || 0;
    const cost = OpenLitHelper.getChatModelCost(
      requestModel,
      pricingInfo,
      inputTokens,
      outputTokens
    );

    AzureAIInferenceWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user,
      cost,
      aiSystem: AzureAIInferenceWrapper.aiSystem,
      serverAddress,
      serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);

    if (result.usage?.prompt_tokens_details?.cached_tokens) {
      span.setAttribute(
        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        result.usage.prompt_tokens_details.cached_tokens
      );
    }
    if (result.usage?.input_tokens_details?.cache_creation_tokens) {
      span.setAttribute(
        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        result.usage.input_tokens_details.cache_creation_tokens
      );
    }

    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    const choices = result.choices || [];
    if (choices[0]?.finish_reason) {
      span.setAttribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        [choices[0].finish_reason]
      );
    }

    const outputType =
      typeof choices[0]?.message?.content === 'string'
        ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
        : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    if (choices[0]?.message?.tool_calls) {
      const toolCalls = choices[0].message.tool_calls;
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
      const toolCalls = choices[0]?.message?.tool_calls;
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        choices[0]?.message?.content || '',
        choices[0]?.finish_reason || 'stop',
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
        [SemanticConvention.SERVER_ADDRESS]: serverAddress,
        [SemanticConvention.SERVER_PORT]: serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: result.id,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [choices[0]?.finish_reason || 'stop'],
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
      aiSystem: AzureAIInferenceWrapper.aiSystem,
    };
  }

  // ──────────────────── Embeddings ────────────────────

  static _patchEmbeddings(
    tracer: Tracer,
    serverAddress: string,
    serverPort: number
  ): any {
    const genAIEndpoint = 'az.ai.inference.embeddings';
    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const body = args[0]?.body || {};
        const requestModel = body.model || 'text-embedding-3-small';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(
            SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
            requestModel,
            serverAddress,
            serverPort
          ),
        }, effectiveCtx);

        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          const captureContent = OpenlitConfig.captureMessageContent;
          let metricParams: BaseSpanAttributes | undefined;
          try {
            const httpResponse = await originalMethod.apply(this, args);
            const responseBody = httpResponse?.body ?? httpResponse;

            if (responseBody && typeof responseBody === 'object') {
              const responseModel = responseBody.model || requestModel;
              const pricingInfo = OpenlitConfig.pricingInfo || {};
              const inputTokens = responseBody.usage?.prompt_tokens || 0;
              const cost = OpenLitHelper.getEmbedModelCost(requestModel, pricingInfo, inputTokens);

              const { encoding_format = 'float', input, dimensions, user } = body;

              AzureAIInferenceWrapper.setBaseSpanAttributes(span, {
                genAIEndpoint,
                model: requestModel,
                user,
                cost,
                aiSystem: AzureAIInferenceWrapper.aiSystem,
                serverAddress,
                serverPort,
              });

              span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
              span.setAttribute(SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS, [encoding_format]);
              if (dimensions) {
                span.setAttribute(SemanticConvention.GEN_AI_EMBEDDINGS_DIMENSION_COUNT, dimensions);
              }
              if (captureContent) {
                const formattedInput = typeof input === 'string' ? input : JSON.stringify(input);
                span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, formattedInput);
              }

              span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);

              metricParams = {
                genAIEndpoint,
                model: requestModel,
                user,
                cost,
                aiSystem: AzureAIInferenceWrapper.aiSystem,
              };
            }

            return httpResponse;
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

export default AzureAIInferenceWrapper;
