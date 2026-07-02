import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  isFrameworkLlmActive,
  getFrameworkParentContext,
  getCurrentAgentVersion,
} from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

function spanCreationAttrs(
  operationName: string,
  requestModel: string
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: VllmWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: VllmWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: VllmWrapper.serverPort,
  };
}

export default class VllmWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_VLLM;
  // vLLM default server address and port
  static serverAddress = '127.0.0.1';
  static serverPort = 8000;

  static _stampAgentVersion(
    span: Span,
    args: {
      systemInstructionsJson?: string;
      toolDefinitionsJson?: string;
      primaryModel?: string;
      temperature?: number | null;
      top_p?: number | null;
      max_tokens?: number | null;
    }
  ): Record<string, string> {
    const out: Record<string, string> = {};
    try {
      const versionHash = OpenLitHelper.computeAgentVersionHash({
        systemInstructions: args.systemInstructionsJson ?? null,
        toolDefinitions: args.toolDefinitionsJson ?? null,
        primaryModel: args.primaryModel ?? null,
        runtimeConfig: {
          temperature: args.temperature ?? null,
          top_p: args.top_p ?? null,
          max_tokens: args.max_tokens ?? null,
          provider: SemanticConvention.GEN_AI_SYSTEM_VLLM,
        },
        providers: [SemanticConvention.GEN_AI_SYSTEM_VLLM],
      });
      if (versionHash) {
        out[SemanticConvention.OPENLIT_AGENT_VERSION_HASH] = versionHash;
        span.setAttribute(SemanticConvention.OPENLIT_AGENT_VERSION_HASH, versionHash);
      }
    } catch {
      // Hash computation must never fail the wrapped call.
    }
    const versionLabel = getCurrentAgentVersion();
    if (versionLabel) {
      out[SemanticConvention.GEN_AI_AGENT_VERSION] = versionLabel;
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_VERSION, versionLabel);
    }
    return out;
  }

  // ──────────────────── Chat ────────────────────

  static _patchChat(tracer: Tracer): any {
    const genAIEndpoint = 'vllm.chat';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);

        // vLLM uses OpenAI-compatible API: model from request body
        const requestModel = args[0]?.model || 'facebook/opt-125m';
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
            const stream = args[0]?.stream ?? false;
            if (stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                VllmWrapper._chatGenerator({ args, genAIEndpoint, response, span })
              );
            }
            return VllmWrapper._chat({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: VllmWrapper.aiSystem,
              serverAddress: VllmWrapper.serverAddress,
              serverPort: VllmWrapper.serverPort,
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
      metricParams = await VllmWrapper._chatCommonSetter({
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
      // vLLM uses OpenAI-compatible response shape
      const result: any = {
        id: '',
        model: '',
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: '' }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      };
      let toolCalls: any[] = [];

      for await (const chunk of response) {
        timestamps.push(Date.now());
        result.id = chunk.id || result.id;
        result.model = chunk.model || result.model;

        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          result.choices[0].message.content += delta.content;
          result.choices[0].message.role = delta.role || result.choices[0].message.role;
        }
        if (delta?.tool_calls) {
          toolCalls = delta.tool_calls;
        }
        if (chunk.choices?.[0]?.finish_reason) {
          result.choices[0].finish_reason = chunk.choices[0].finish_reason;
        }
        if (chunk.usage) {
          result.usage.prompt_tokens = chunk.usage.prompt_tokens || result.usage.prompt_tokens;
          result.usage.completion_tokens = chunk.usage.completion_tokens || result.usage.completion_tokens;
        }
        yield chunk;
      }

      if (toolCalls.length > 0) {
        result.choices[0].message.tool_calls = toolCalls;
      }

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await VllmWrapper._chatCommonSetter({
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
  }): Promise<BaseSpanAttributes> {
    const captureContent = OpenlitConfig.captureMessageContent;
    const requestModel = args[0]?.model || 'facebook/opt-125m';
    const messages = args[0]?.messages || [];
    const tools = args[0]?.tools;
    const stream = args[0]?.stream ?? false;

    // Request param attributes — no sentinel values per spec
    if (args[0]?.temperature != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, args[0].temperature);
    }
    if (args[0]?.top_p != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, args[0].top_p);
    }
    if (args[0]?.max_tokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, args[0].max_tokens);
    }
    if (args[0]?.frequency_penalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, args[0].frequency_penalty);
    }
    if (args[0]?.presence_penalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, args[0].presence_penalty);
    }
    if (args[0]?.seed != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, Number(args[0].seed));
    }
    if (args[0]?.stop) {
      span.setAttribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        Array.isArray(args[0].stop) ? args[0].stop : [args[0].stop]
      );
    }
    if (args[0]?.n != null && args[0].n !== 1) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, args[0].n);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);

    // Response attributes — vLLM uses OpenAI-compatible token field names
    const responseModel = result.model || requestModel;
    const inputTokens = result.usage?.prompt_tokens || 0;
    const outputTokens = result.usage?.completion_tokens || 0;
    const finishReason = result.choices?.[0]?.finish_reason || 'stop';
    const responseId = result.id || '';
    const outputContent = result.choices?.[0]?.message?.content || '';
    const outputType = SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT;

    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);

    VllmWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      cost,
      aiSystem: VllmWrapper.aiSystem,
      serverAddress: VllmWrapper.serverAddress,
      serverPort: VllmWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, responseId);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    if (ttft > 0) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    if (tbt > 0) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);

    // Tool calls
    const toolCallsResult = result.choices?.[0]?.message?.tool_calls;
    if (toolCallsResult) {
      const toolNames = toolCallsResult.map((t: any) => t.function?.name || '').filter(Boolean);
      const toolIds = toolCallsResult.map((t: any) => String(t.id || '')).filter(Boolean);
      const toolArgs = toolCallsResult.map((t: any) => String(t.function?.arguments || '')).filter(Boolean);
      if (toolNames.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, toolNames.join(', '));
      if (toolIds.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, toolIds.join(', '));
      if (toolArgs.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_ARGS, toolArgs.join(', '));
    }

    // Content + agent version
    const toolDefinitionsJson = OpenLitHelper.buildToolDefinitions(tools);
    const systemInstructionsJson = OpenLitHelper.buildSystemInstructionsFromMessages(messages);
    const versionExtras = VllmWrapper._stampAgentVersion(span, {
      systemInstructionsJson,
      toolDefinitionsJson,
      primaryModel: responseModel || requestModel,
      temperature: args[0]?.temperature ?? null,
      top_p: args[0]?.top_p ?? null,
      max_tokens: args[0]?.max_tokens ?? null,
    });

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;
    if (captureContent) {
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        outputContent,
        finishReason,
        toolCallsResult
      );
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      inputMessagesJson = OpenLitHelper.buildInputMessages(messages);
      if (systemInstructionsJson) {
        span.setAttribute(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstructionsJson);
      }
    }
    if (toolDefinitionsJson) {
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
    }

    // Emit inference event — always, independent of captureMessageContent
    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: VllmWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: VllmWrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: responseId,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason],
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
        ...versionExtras,
      };
      if (captureContent) {
        if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
        if (outputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
        if (systemInstructionsJson) eventAttrs[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = systemInstructionsJson;
      }
      if (toolDefinitionsJson) eventAttrs[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = toolDefinitionsJson;
      OpenLitHelper.emitInferenceEvent(span, eventAttrs);
    }

    return {
      genAIEndpoint,
      model: requestModel,
      cost,
      aiSystem: VllmWrapper.aiSystem,
      serverAddress: VllmWrapper.serverAddress,
      serverPort: VllmWrapper.serverPort,
    };
  }
}