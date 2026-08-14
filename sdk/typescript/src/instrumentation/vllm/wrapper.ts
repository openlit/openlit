/**
 * vLLM TypeScript instrumentation.
 *
 * vLLM exposes an OpenAI-compatible HTTP API; the JS SDK routes traffic through
 * the official `openai` npm client pointed at a vLLM server (typically localhost:8000).
 * Python wraps the native `vllm.LLM.generate` API instead — parity is at the span
 * attribute / event level, not the patch target.
 */

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
  requestModel: string,
  serverAddress: string,
  serverPort: number
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: VllmWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: serverAddress,
    [SemanticConvention.SERVER_PORT]: serverPort,
  };
}

export default class VllmWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_VLLM;
  static serverAddress = '127.0.0.1';
  static serverPort = 8000;

  /** Default baseURL prefixes that identify a vLLM OpenAI-compatible endpoint. */
  static defaultBaseUrlPrefixes = [
    'http://127.0.0.1:8000',
    'http://localhost:8000',
    'https://127.0.0.1:8000',
    'https://localhost:8000',
  ];

  /** Mutable allowlist; extended via VllmInstrumentationConfig.baseUrlPrefixes. */
  static baseUrlPrefixes = [...VllmWrapper.defaultBaseUrlPrefixes];

  static extractClientBaseUrl(client: any): string | undefined {
    return (
      client?.baseURL
      ?? client?._client?.baseURL
      ?? client?.__client?.baseURL
      ?? undefined
    );
  }

  static isVllmClient(client: any): boolean {
    const baseUrl = VllmWrapper.extractClientBaseUrl(client);
    if (!baseUrl) {
      return false;
    }

    try {
      const parsed = new URL(baseUrl);
      if (parsed.hostname === 'api.openai.com') {
        return false;
      }

      const normalized = baseUrl.replace(/\/$/, '');
      for (const prefix of VllmWrapper.baseUrlPrefixes) {
        if (normalized.startsWith(prefix.replace(/\/$/, ''))) {
          return true;
        }
      }

      const port = parsed.port
        ? parseInt(parsed.port, 10)
        : (parsed.protocol === 'https:' ? 443 : 80);
      const host = parsed.hostname.toLowerCase();
      return (host === '127.0.0.1' || host === 'localhost') && port === 8000;
    } catch {
      return false;
    }
  }

  static extractServerInfo(client: any): { address: string; port: number } {
    const baseUrl = VllmWrapper.extractClientBaseUrl(client);
    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        return {
          address: parsed.hostname,
          port: parsed.port
            ? parseInt(parsed.port, 10)
            : (parsed.protocol === 'https:' ? 443 : 80),
        };
      } catch {
        /* fall through to defaults */
      }
    }
    return { address: VllmWrapper.serverAddress, port: VllmWrapper.serverPort };
  }

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

  static _patchChat(
    tracer: Tracer,
    openaiHandler: (...args: any[]) => any,
    rawCreate: (...args: any[]) => any
  ): any {
    const genAIEndpoint = 'vllm.chat';
    return (_originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (!VllmWrapper.isVllmClient(this)) {
          return openaiHandler.apply(this, args);
        }

        if (isFrameworkLlmActive()) {
          return rawCreate.apply(this, args);
        }

        const { address: serverAddress, port: serverPort } = VllmWrapper.extractServerInfo(this);
        const requestModel = args[0]?.model || 'facebook/opt-125m';
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

        return context
          .with(trace.setSpan(effectiveCtx, span), async () => {
            return rawCreate.apply(this, args);
          })
          .then((response: any) => {
            const stream = args[0]?.stream ?? false;
            if (stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                VllmWrapper._chatGenerator({
                  args,
                  genAIEndpoint,
                  response,
                  span,
                  serverAddress,
                  serverPort,
                })
              );
            }
            return VllmWrapper._chat({
              args,
              genAIEndpoint,
              response,
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
              aiSystem: VllmWrapper.aiSystem,
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

  static async _chat({
    args,
    genAIEndpoint,
    response,
    span,
    serverAddress,
    serverPort,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
    serverAddress: string;
    serverPort: number;
  }): Promise<any> {
    let metricParams;
    try {
      metricParams = await VllmWrapper._chatCommonSetter({
        args,
        genAIEndpoint,
        result: response,
        span,
        serverAddress,
        serverPort,
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
    serverAddress,
    serverPort,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
    serverAddress: string;
    serverPort: number;
  }): AsyncGenerator<unknown, any, unknown> {
    let metricParams;
    const timestamps: number[] = [];
    const startTime = Date.now();
    const messages = args[0]?.messages || [];

    try {
      const result: any = {
        id: '',
        model: '',
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: '' }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      };
      const toolCalls: any[] = [];

      for await (const chunk of response) {
        timestamps.push(Date.now());
        result.id = chunk.id || result.id;
        result.model = chunk.model || result.model;

        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          result.choices[0].message.content += delta.content;
          result.choices[0].message.role = delta.role || result.choices[0].message.role;
        }
        if (chunk.choices?.[0]?.delta?.tool_calls) {
          const deltaTools = chunk.choices[0].delta.tool_calls;
          for (const tool of deltaTools) {
            const idx = tool.index ?? 0;
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

      if (!result.usage.prompt_tokens && !result.usage.completion_tokens) {
        let promptTokens = 0;
        for (const message of messages) {
          promptTokens += OpenLitHelper.openaiTokens(message.content as string, result.model) ?? 0;
        }
        const completionTokens = OpenLitHelper.openaiTokens(
          result.choices[0].message.content ?? '',
          result.model
        );
        if (promptTokens || completionTokens) {
          result.usage = {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
          };
        }
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
        serverAddress,
        serverPort,
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
    serverAddress = VllmWrapper.serverAddress,
    serverPort = VllmWrapper.serverPort,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    ttft?: number;
    tbt?: number;
    serverAddress?: string;
    serverPort?: number;
  }): Promise<BaseSpanAttributes> {
    const captureContent = OpenlitConfig.captureMessageContent;
    const requestModel = args[0]?.model || 'facebook/opt-125m';
    const messages = args[0]?.messages || [];
    const tools = args[0]?.tools;
    const stream = args[0]?.stream ?? false;

    if (args[0]?.temperature != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, args[0].temperature);
    }
    if (args[0]?.top_p != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, args[0].top_p);
    }
    if (args[0]?.top_k != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, args[0].top_k);
    }
    if (args[0]?.max_tokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, args[0].max_tokens);
    }
    if (args[0]?.frequency_penalty != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, args[0].frequency_penalty);
    }
    if (args[0]?.presence_penalty != null) {
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

    const responseModel = result.model || requestModel;
    let inputTokens = result.usage?.prompt_tokens || 0;
    let outputTokens = result.usage?.completion_tokens || 0;

    if (!inputTokens && !outputTokens) {
      for (const message of messages) {
        inputTokens += OpenLitHelper.openaiTokens(message.content as string, responseModel) ?? 0;
      }
      outputTokens = OpenLitHelper.openaiTokens(
        result.choices?.[0]?.message?.content ?? '',
        responseModel
      ) ?? 0;
    }

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
      serverAddress,
      serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, responseId);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
    if (inputTokens + outputTokens > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, inputTokens + outputTokens);
    }
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    if (ttft > 0) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    if (tbt > 0) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);

    const toolCallsResult = result.choices?.[0]?.message?.tool_calls;
    if (toolCallsResult) {
      const toolNames = toolCallsResult.map((t: any) => t.function?.name || '').filter(Boolean);
      const toolIds = toolCallsResult.map((t: any) => String(t.id || '')).filter(Boolean);
      const toolArgs = toolCallsResult.map((t: any) => String(t.function?.arguments || '')).filter(Boolean);
      if (toolNames.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, toolNames.join(', '));
      if (toolIds.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, toolIds.join(', '));
      if (toolArgs.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_ARGS, toolArgs.join(', '));
    }

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
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
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
        [SemanticConvention.SERVER_ADDRESS]: serverAddress,
        [SemanticConvention.SERVER_PORT]: serverPort,
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
      serverAddress,
      serverPort,
    };
  }
}
