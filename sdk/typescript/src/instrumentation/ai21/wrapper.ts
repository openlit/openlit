import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  isFrameworkLlmActive,
  getFrameworkParentContext,
  getCurrentAgentVersion,
} from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

function spanCreationAttrs(
  operationName: string,
  requestModel: string
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: AI21Wrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: AI21Wrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: AI21Wrapper.serverPort,
  };
}

class AI21Wrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_AI21;
  static serverAddress = 'api.ai21.com';
  static serverPort = 443;

  static _patchChatCompletionCreate(tracer: Tracer): any {
    const genAIEndpoint = 'ai21.chat.completions';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'jamba-mini';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(
          spanName,
          {
            kind: SpanKind.CLIENT,
            attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, requestModel),
          },
          effectiveCtx
        );
        return context
          .with(trace.setSpan(effectiveCtx, span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            const { stream = false } = args[0];

            if (stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                AI21Wrapper._chatCompletionGenerator({
                  args,
                  genAIEndpoint,
                  response,
                  span,
                })
              );
            }

            return AI21Wrapper._chatCompletion({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: AI21Wrapper.aiSystem,
              serverAddress: AI21Wrapper.serverAddress,
              serverPort: AI21Wrapper.serverPort,
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
      metricParams = await AI21Wrapper._chatCompletionCommonSetter({
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
      const result = {
        id: '0',
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

      for await (const chunk of response) {
        timestamps.push(Date.now());

        if (chunk.id) {
          result.id = chunk.id;
        }
        // AI21 stream chunks currently carry no `model`, so this is defensive:
        // keep streaming aligned with the non-streaming path (which also falls
        // back to the request model) if the API ever starts emitting one.
        if (chunk.model && !result.model) {
          result.model = chunk.model;
        }
        if (chunk.choices?.[0]?.finish_reason) {
          result.choices[0].finish_reason = chunk.choices[0].finish_reason;
        }
        if (chunk.choices?.[0]?.delta?.content) {
          result.choices[0].message.content += chunk.choices[0].delta.content;
        }

        // AI21 emits usage on the final chunk (UsageInfo), unlike groq's x_groq.usage.
        if (chunk.usage) {
          result.usage.prompt_tokens = chunk.usage.prompt_tokens || 0;
          result.usage.completion_tokens = chunk.usage.completion_tokens || 0;
          result.usage.total_tokens = chunk.usage.total_tokens || 0;
        }

        yield chunk;
      }

      // Fall back to local token counting if the stream did not report usage.
      if (!result.usage.prompt_tokens && !result.usage.completion_tokens) {
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
      }

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await AI21Wrapper._chatCompletionCommonSetter({
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
    const requestModel = args[0]?.model || 'jamba-mini';
    const {
      messages,
      max_tokens = null,
      n = 1,
      stop = null,
      temperature = 1,
      top_p,
      user,
      stream = false,
      tools: _tools,
    } = args[0];

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p ?? 1);
    if (max_tokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
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

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);

    const responseModel = result.model || requestModel;

    const pricingInfo = OpenlitConfig.pricingInfo || {};

    const cost = OpenLitHelper.getChatModelCost(
      requestModel,
      pricingInfo,
      result.usage.prompt_tokens,
      result.usage.completion_tokens
    );

    AI21Wrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user,
      cost,
      aiSystem: AI21Wrapper.aiSystem,
      serverAddress: AI21Wrapper.serverAddress,
      serverPort: AI21Wrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);

    const inputTokens = result.usage.prompt_tokens;
    const outputTokens = result.usage.completion_tokens;
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);

    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    if (result.choices[0].finish_reason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [
        result.choices[0].finish_reason,
      ]);
    }

    const outputType =
      typeof result.choices[0].message.content === 'string'
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
    const toolDefinitionsJson = OpenLitHelper.buildToolDefinitions(_tools);
    // Always extract system_instructions so the version hash can be computed
    // even when content capture is disabled.
    const systemInstructionsJson = OpenLitHelper.buildSystemInstructionsFromMessages(messages || []);

    const versionExtras: Record<string, string> = {};
    try {
      const versionHash = OpenLitHelper.computeAgentVersionHash({
        systemInstructions: systemInstructionsJson ?? null,
        toolDefinitions: toolDefinitionsJson ?? null,
        primaryModel: responseModel || requestModel,
        runtimeConfig: {
          temperature: temperature ?? null,
          top_p: top_p ?? null,
          max_tokens: max_tokens ?? null,
          provider: SemanticConvention.GEN_AI_SYSTEM_AI21,
        },
        providers: [SemanticConvention.GEN_AI_SYSTEM_AI21],
      });
      if (versionHash) {
        versionExtras[SemanticConvention.OPENLIT_AGENT_VERSION_HASH] = versionHash;
        span.setAttribute(SemanticConvention.OPENLIT_AGENT_VERSION_HASH, versionHash);
      }
    } catch {
      // Never fail the wrapped call on hash issues.
    }
    const versionLabel = getCurrentAgentVersion();
    if (versionLabel) {
      versionExtras[SemanticConvention.GEN_AI_AGENT_VERSION] = versionLabel;
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_VERSION, versionLabel);
    }

    if (captureContent) {
      const toolCalls = result.choices[0].message.tool_calls;
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        result.choices[0].message.content || '',
        result.choices[0].finish_reason || 'stop',
        toolCalls
      );
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      inputMessagesJson = OpenLitHelper.buildInputMessages(messages || []);
      if (systemInstructionsJson) {
        span.setAttribute(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstructionsJson);
      }
    }
    if (toolDefinitionsJson) {
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: AI21Wrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: AI21Wrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: result.id,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [result.choices[0].finish_reason],
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
        ...versionExtras,
      };
      if (captureContent) {
        if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
        if (systemInstructionsJson)
          eventAttrs[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = systemInstructionsJson;
        if (outputMessagesJson)
          eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
      }
      if (toolDefinitionsJson) eventAttrs[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = toolDefinitionsJson;
      OpenLitHelper.emitInferenceEvent(span, eventAttrs);
    }

    return {
      genAIEndpoint,
      model: requestModel,
      user,
      cost,
      aiSystem: AI21Wrapper.aiSystem,
    };
  }

  // --- Conversational RAG ---------------------------------------------------
  // Mirrors the Python reference (ai21/ai21.py chat_rag + utils.py
  // common_chat_rag_logic). The RAG surface is never streamed, responses carry
  // no `model` and no usage token counts (counted locally), and the answer is
  // at `choices[i].content` (flat) rather than `choices[i].message.content`.

  static _patchConversationalRagCreate(tracer: Tracer): any {
    const genAIEndpoint = 'ai21.conversational_rag';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'jamba-1.5-mini';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(
          spanName,
          {
            kind: SpanKind.CLIENT,
            attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, requestModel),
          },
          effectiveCtx
        );
        return context
          .with(trace.setSpan(effectiveCtx, span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            return AI21Wrapper._chatRag({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: AI21Wrapper.aiSystem,
              serverAddress: AI21Wrapper.serverAddress,
              serverPort: AI21Wrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static async _chatRag({
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
      metricParams = await AI21Wrapper._chatRagCommonSetter({
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

  static async _chatRagCommonSetter({
    args,
    genAIEndpoint,
    result,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
  }) {
    const captureContent = OpenlitConfig.captureMessageContent;
    const requestModel = args[0]?.model || 'jamba-1.5-mini';
    const {
      messages,
      n = 1,
      user,
      max_segments,
      retrieval_strategy,
      max_neighbors,
      file_ids,
      path,
      retrieval_similarity_threshold,
      tools: _tools,
    } = args[0];

    // RAG choices are flat ChatMessage objects (`content` on the choice).
    const choices = result.choices || [];
    let llmResponse = '';
    for (let i = 0; i < n; i++) {
      llmResponse += choices[i]?.content ?? '';
    }

    // RAG responses report no usage; count tokens locally (mirrors Python
    // general_tokens over the formatted prompt and the aggregated answer).
    let inputTokens = 0;
    for (const message of messages || []) {
      inputTokens += OpenLitHelper.openaiTokens(message.content as string, requestModel) ?? 0;
    }
    const outputTokens = OpenLitHelper.openaiTokens(llmResponse, requestModel) ?? 0;

    const responseModel = requestModel;
    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);

    AI21Wrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user,
      cost,
      aiSystem: AI21Wrapper.aiSystem,
      serverAddress: AI21Wrapper.serverAddress,
      serverPort: AI21Wrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

    // RAG-specific attributes (defaults mirror the Python implementation).
    span.setAttribute(SemanticConvention.GEN_AI_RAG_MAX_SEGMENTS, max_segments ?? -1);
    span.setAttribute(SemanticConvention.GEN_AI_RAG_STRATEGY, retrieval_strategy ?? 'segments');
    span.setAttribute(SemanticConvention.GEN_AI_RAG_MAX_NEIGHBORS, max_neighbors ?? -1);
    span.setAttribute(SemanticConvention.GEN_AI_RAG_FILE_IDS, file_ids != null ? String(file_ids) : '');
    span.setAttribute(SemanticConvention.GEN_AI_RAG_DOCUMENTS_PATH, path ?? '');
    span.setAttribute(
      SemanticConvention.GEN_AI_RAG_SIMILARITY_THRESHOLD,
      retrieval_similarity_threshold ?? -1
    );

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);

    const outputType =
      typeof llmResponse === 'string'
        ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
        : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;
    const toolDefinitionsJson = OpenLitHelper.buildToolDefinitions(_tools);

    if (captureContent) {
      inputMessagesJson = OpenLitHelper.buildInputMessages(messages || []);
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
      outputMessagesJson = OpenLitHelper.buildOutputMessages(llmResponse, 'stop', undefined);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
    }
    if (toolDefinitionsJson) {
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: AI21Wrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: AI21Wrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: result.id,
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
      };
      if (captureContent) {
        if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
        if (outputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
      }
      if (toolDefinitionsJson) eventAttrs[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = toolDefinitionsJson;
      OpenLitHelper.emitInferenceEvent(span, eventAttrs);
    }

    return {
      genAIEndpoint,
      model: requestModel,
      user,
      cost,
      aiSystem: AI21Wrapper.aiSystem,
    };
  }
}

export default AI21Wrapper;
