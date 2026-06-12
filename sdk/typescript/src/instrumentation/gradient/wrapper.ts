import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  isFrameworkLlmActive,
  getFrameworkParentContext,
  getCurrentAgentVersion,
} from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';
import {
  agentIdFromHost,
  applyGradientChatRequestAttributes,
  gradientSpanCreationAttrs,
  resolveGradientEndpoint,
  GradientEndpointKind,
} from './utils';

const AI_SYSTEM = SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN;

type ChatPatchOptions = {
  operationName: string;
  endpointKind: GradientEndpointKind;
  genAIEndpoint: string;
  apiType: string;
  isAgent?: boolean;
};

class GradientWrapper extends BaseWrapper {
  static aiSystem = AI_SYSTEM;

  static _patchChatCompletionCreate(tracer: Tracer): any {
    return GradientWrapper._buildChatPatch(tracer, {
      operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
      endpointKind: 'inference',
      genAIEndpoint: 'digitalocean.chat.completions',
      apiType: 'chat',
    });
  }

  static _patchAgentChatCompletionCreate(tracer: Tracer): any {
    return GradientWrapper._buildChatPatch(tracer, {
      operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
      endpointKind: 'agent',
      genAIEndpoint: 'digitalocean.agents.chat.completions',
      apiType: 'chat',
      isAgent: true,
    });
  }

  static _buildChatPatch(tracer: Tracer, options: ChatPatchOptions): any {
    const { operationName, endpointKind, genAIEndpoint, apiType, isAgent = false } = options;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);

        const body = args[0] || {};
        const requestModel = body.model || 'unknown';
        const [serverAddress, serverPort] = resolveGradientEndpoint(this, endpointKind);
        const spanName = `${operationName} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(
          spanName,
          {
            kind: SpanKind.CLIENT,
            attributes: gradientSpanCreationAttrs(operationName, requestModel, serverAddress, serverPort),
          },
          effectiveCtx
        );

        if (isAgent) {
          const agentId = agentIdFromHost(serverAddress);
          if (agentId) {
            span.setAttribute(SemanticConvention.GEN_AI_AGENT_ID, agentId);
          }
        }

        return context
          .with(trace.setSpan(effectiveCtx, span), async () => originalMethod.apply(this, args))
          .then((response: any) => {
            if (body.stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                GradientWrapper._chatCompletionGenerator({
                  args,
                  genAIEndpoint,
                  response,
                  span,
                  serverAddress,
                  serverPort,
                  operationName,
                  apiType,
                })
              );
            }
            return GradientWrapper._chatCompletion({
              args,
              genAIEndpoint,
              response,
              span,
              serverAddress,
              serverPort,
              operationName,
              apiType,
            });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: AI_SYSTEM,
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

  static _patchImageGenerate(tracer: Tracer): any {
    const genAIEndpoint = 'digitalocean.images.generate';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);

        const body = args[0] || {};
        const requestModel = body.model || 'unknown';
        const [serverAddress, serverPort] = resolveGradientEndpoint(this, 'inference');
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(
          spanName,
          {
            kind: SpanKind.CLIENT,
            attributes: gradientSpanCreationAttrs(
              SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
              requestModel,
              serverAddress,
              serverPort
            ),
          },
          effectiveCtx
        );

        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          let metricParams;
          try {
            const response = await originalMethod.apply(this, args);
            metricParams = GradientWrapper._imageGenerateCommonSetter({
              args,
              genAIEndpoint,
              response,
              span,
              serverAddress,
              serverPort,
            });
            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: AI_SYSTEM,
              serverAddress,
              serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
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

  static async _chatCompletion({
    args,
    genAIEndpoint,
    response,
    span,
    serverAddress,
    serverPort,
    operationName,
    apiType,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
    serverAddress: string;
    serverPort: number;
    operationName: string;
    apiType: string;
  }): Promise<any> {
    let metricParams;
    try {
      metricParams = await GradientWrapper._chatCompletionCommonSetter({
        args,
        genAIEndpoint,
        result: response,
        span,
        serverAddress,
        serverPort,
        operationName,
        apiType,
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
    serverAddress,
    serverPort,
    operationName,
    apiType,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
    serverAddress: string;
    serverPort: number;
    operationName: string;
    apiType: string;
  }): AsyncGenerator<unknown, any, unknown> {
    let metricParams;
    const timestamps: number[] = [];
    const startTime = Date.now();

    try {
      const { messages } = args[0];
      let { tools } = args[0];
      const result = {
        id: '0',
        created: -1,
        model: '',
        system_fingerprint: '',
        choices: [
          {
            index: 0,
            logprobs: null,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '', reasoning_content: '' },
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };

      const toolCalls: any[] = [];
      let reasoningText = '';

      for await (const chunk of response) {
        timestamps.push(Date.now());

        if (chunk.id) result.id = chunk.id;
        if (chunk.created) result.created = chunk.created;
        if (chunk.model) result.model = chunk.model;
        if (chunk.system_fingerprint) result.system_fingerprint = chunk.system_fingerprint;

        if (chunk.choices?.[0]?.finish_reason) {
          result.choices[0].finish_reason = chunk.choices[0].finish_reason;
        }
        if (chunk.choices?.[0]?.logprobs) {
          result.choices[0].logprobs = chunk.choices[0].logprobs;
        }
        if (chunk.choices?.[0]?.delta?.content) {
          result.choices[0].message.content += chunk.choices[0].delta.content;
        }
        if (chunk.choices?.[0]?.delta?.reasoning_content) {
          reasoningText += chunk.choices[0].delta.reasoning_content;
          (result.choices[0].message as any).reasoning_content = reasoningText;
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
              if (tool.function?.name) toolCalls[idx].function.name = tool.function.name;
              if (tool.function?.arguments) toolCalls[idx].function.arguments = tool.function.arguments;
            } else if (tool.function?.arguments) {
              toolCalls[idx].function.arguments += tool.function.arguments;
            }
          }
          tools = true;
        }

        if (chunk.usage) {
          result.usage.prompt_tokens = chunk.usage.prompt_tokens || 0;
          result.usage.completion_tokens = chunk.usage.completion_tokens || 0;
          result.usage.total_tokens = chunk.usage.total_tokens || 0;
          const details = chunk.usage.output_tokens_details || chunk.usage.completion_tokens_details;
          if (details?.reasoning_tokens) {
            result.usage.output_tokens_details.reasoning_tokens = details.reasoning_tokens;
          }
        }

        yield chunk;
      }

      if (toolCalls.length > 0) {
        result.choices[0].message = {
          ...result.choices[0].message,
          tool_calls: toolCalls,
        } as any;
      }

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
            ...result.usage,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          };
        }
      }

      args[0].tools = tools;

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await GradientWrapper._chatCompletionCommonSetter({
        args,
        genAIEndpoint,
        result,
        span,
        ttft,
        tbt,
        serverAddress,
        serverPort,
        operationName,
        apiType,
        reasoningText,
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

  static _imageGenerateCommonSetter({
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
  }) {
    const captureContent = OpenlitConfig.captureMessageContent;
    const body = args[0] || {};
    const requestModel = body.model || 'unknown';
    const responseModel = response?.model || requestModel;
    const size = body.size || response?.size || '1024x1024';
    const quality = body.quality || response?.quality || 'standard';
    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getImageModelCost(requestModel, pricingInfo, size, quality as any);

    GradientWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user: body.user,
      cost,
      aiSystem: AI_SYSTEM,
      serverAddress,
      serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, 'image');
    if (response?.created != null) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, String(response.created));
    }
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);

    if (captureContent && body.prompt) {
      span.setAttribute(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        JSON.stringify([
          {
            role: 'user',
            parts: [{ type: 'text', content: String(body.prompt) }],
          },
        ])
      );
    }

    return {
      genAIEndpoint,
      model: requestModel,
      user: body.user,
      cost,
      aiSystem: AI_SYSTEM,
      serverAddress,
      serverPort,
    };
  }

  static async _chatCompletionCommonSetter({
    args,
    genAIEndpoint,
    result,
    span,
    ttft = 0,
    tbt = 0,
    serverAddress,
    serverPort,
    operationName = SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    apiType = 'chat',
    reasoningText,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    ttft?: number;
    tbt?: number;
    serverAddress: string;
    serverPort: number;
    operationName?: string;
    apiType?: string;
    reasoningText?: string;
  }) {
    const captureContent = OpenlitConfig.captureMessageContent;
    const body = args[0] || {};
    const requestModel = body.model || 'unknown';
    const { messages, tools: _tools, stream: _stream = false } = body;

    applyGradientChatRequestAttributes(span, body);
    span.setAttribute(SemanticConvention.OPENAI_API_TYPE, apiType);

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
    const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getChatModelCost(
      requestModel,
      pricingInfo,
      usage.prompt_tokens,
      usage.completion_tokens
    );

    GradientWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user: body.user,
      cost,
      aiSystem: AI_SYSTEM,
      serverAddress,
      serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);

    if (result.system_fingerprint) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_SYSTEM_FINGERPRINT, result.system_fingerprint);
    }

    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, inputTokens + outputTokens);

    const reasoningTokens =
      usage.output_tokens_details?.reasoning_tokens ??
      usage.completion_tokens_details?.reasoning_tokens ??
      0;
    if (reasoningTokens) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS, reasoningTokens);
    }

    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    if (result.choices?.[0]?.finish_reason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [
        result.choices[0].finish_reason,
      ]);
    }

    const outputType =
      (body.response_format as any)?.type === 'json_object'
        ? SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON
        : SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    const message = result.choices?.[0]?.message || {};
    const resolvedReasoning =
      reasoningText ||
      message.reasoning_content ||
      '';
    if (message.tool_calls) {
      const toolCalls = message.tool_calls;
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
    const systemInstructionsJson = OpenLitHelper.buildSystemInstructionsFromMessages(messages || []);

    const versionExtras: Record<string, string> = {};
    try {
      const maxTokens = body.max_completion_tokens ?? body.max_tokens ?? null;
      const versionHash = OpenLitHelper.computeAgentVersionHash({
        systemInstructions: systemInstructionsJson ?? null,
        toolDefinitions: toolDefinitionsJson ?? null,
        primaryModel: responseModel || requestModel,
        runtimeConfig: {
          temperature: body.temperature ?? null,
          top_p: body.top_p ?? null,
          max_tokens: maxTokens,
          provider: AI_SYSTEM,
        },
        providers: [AI_SYSTEM],
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
      const toolCalls = message.tool_calls;
      outputMessagesJson = GradientWrapper._buildOutputMessages(
        message.content || '',
        result.choices?.[0]?.finish_reason || 'stop',
        toolCalls,
        resolvedReasoning || undefined
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
        [SemanticConvention.GEN_AI_OPERATION]: operationName,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: serverAddress,
        [SemanticConvention.SERVER_PORT]: serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: result.id,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [result.choices?.[0]?.finish_reason],
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
        ...versionExtras,
      };
      if (captureContent) {
        if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
        if (systemInstructionsJson) {
          eventAttrs[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = systemInstructionsJson;
        }
        if (outputMessagesJson) {
          eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
        }
      }
      if (toolDefinitionsJson) {
        eventAttrs[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = toolDefinitionsJson;
      }
      OpenLitHelper.emitInferenceEvent(span, eventAttrs);
    }

    return {
      genAIEndpoint,
      model: requestModel,
      user: body.user,
      cost,
      aiSystem: AI_SYSTEM,
      serverAddress,
      serverPort,
    };
  }

  static _buildOutputMessages(
    text: string,
    finishReason: string,
    toolCalls?: any[],
    reasoning?: string
  ): string {
    try {
      const parts: any[] = [];
      if (reasoning) {
        parts.push({ type: 'reasoning', content: reasoning });
      }
      if (text) {
        parts.push({ type: 'text', content: text });
      }
      if (toolCalls?.length) {
        for (const tc of toolCalls) {
          let argsVal = tc.function?.arguments || tc.arguments || {};
          if (typeof argsVal === 'string') {
            try {
              argsVal = JSON.parse(argsVal);
            } catch {
              argsVal = { raw: argsVal };
            }
          }
          parts.push({
            type: 'tool_call',
            id: tc.id || '',
            name: tc.function?.name || tc.name || '',
            arguments: argsVal,
          });
        }
      }
      return JSON.stringify([
        { role: 'assistant', parts, finish_reason: finishReason || 'stop' },
      ]);
    } catch {
      return '[]';
    }
  }
}

export default GradientWrapper;
