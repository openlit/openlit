import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  isFrameworkLlmActive,
  getFrameworkParentContext,
  getCurrentAgentVersion,
} from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

// Derive the regional API endpoint from the model/session instance.
// @google-cloud/vertexai exposes `location` on GenerativeModel and ChatSession.

function extractServerAddress(instance: any): string {
  const location =
    instance?.location ||
    instance?._location ||
    instance?.generativeModel?.location ||
    instance?.generativeModel?._location ||
    'us-central1';
  return `${location}-aiplatform.googleapis.com`;
}

function spanCreationAttrs(
  operationName: string,
  requestModel: string,
  serverAddress: string
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: VertexAIWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: serverAddress,
    [SemanticConvention.SERVER_PORT]: VertexAIWrapper.serverPort,
  };
}

class VertexAIWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_VERTEXAI;
  static serverPort = 443;

  // Exposed as a static method so it can be unit-tested directly.
  // Strips full Vertex AI resource paths to the short model name.
  // e.g. projects/p/locations/l/publishers/google/models/gemini-2.0-flash → gemini-2.0-flash
  static _extractModelName(instance: any): string {
    const raw =
      instance?.model ||
      instance?._modelId ||
      instance?.generativeModel?.model ||
      instance?.generativeModel?._modelId ||
      'gemini-2.0-flash';
    return String(raw)
      .replace(/^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\//, '')
      .replace(/^publishers\/[^/]+\/models\//, '');
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
          provider: SemanticConvention.GEN_AI_SYSTEM_VERTEXAI,
        },
        providers: [SemanticConvention.GEN_AI_SYSTEM_VERTEXAI],
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

  // Shared span/context/error boilerplate for all four patch methods.
  // Only genAIEndpoint, isStream, and isChatSession vary between them.
  static _buildPatcher({
    genAIEndpoint,
    isStream,
    isChatSession,
    tracer,
  }: {
    genAIEndpoint: string;
    isStream: boolean;
    isChatSession: boolean;
    tracer: Tracer;
  }): (originalMethod: (...args: any[]) => any) => (...args: any[]) => Promise<any> {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = VertexAIWrapper._extractModelName(this);
        const serverAddress = extractServerAddress(this);
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(
          spanName,
          {
            kind: SpanKind.CLIENT,
            attributes: spanCreationAttrs(
              SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
              requestModel,
              serverAddress
            ),
          },
          effectiveCtx
        );
        return context
          .with(trace.setSpan(effectiveCtx, span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((result: any) => {
            if (isStream) {
              const wrappedStream = VertexAIWrapper._streamGenerator({
                args,
                genAIEndpoint,
                stream: result.stream,
                span,
                requestModel,
                serverAddress,
                isChatSession,
              });
              return { ...result, stream: wrappedStream };
            }
            return VertexAIWrapper._processResponse({
              args,
              genAIEndpoint,
              response: result,
              span,
              requestModel,
              serverAddress,
              isChatSession,
            });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: VertexAIWrapper.aiSystem,
              serverAddress,
              serverPort: VertexAIWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static _patchGenerateContent(tracer: Tracer): any {
    return VertexAIWrapper._buildPatcher({
      genAIEndpoint: 'vertexai.generative_models.generate_content',
      isStream: false,
      isChatSession: false,
      tracer,
    });
  }

  static _patchGenerateContentStream(tracer: Tracer): any {
    return VertexAIWrapper._buildPatcher({
      genAIEndpoint: 'vertexai.generative_models.generate_content_stream',
      isStream: true,
      isChatSession: false,
      tracer,
    });
  }

  static _patchSendMessage(tracer: Tracer): any {
    return VertexAIWrapper._buildPatcher({
      genAIEndpoint: 'vertexai.generative_models.chat_session.send_message',
      isStream: false,
      isChatSession: true,
      tracer,
    });
  }

  static _patchSendMessageStream(tracer: Tracer): any {
    return VertexAIWrapper._buildPatcher({
      genAIEndpoint: 'vertexai.generative_models.chat_session.send_message_stream',
      isStream: true,
      isChatSession: true,
      tracer,
    });
  }

  static async _processResponse({
    args,
    genAIEndpoint,
    response,
    span,
    requestModel,
    serverAddress,
    isChatSession = false,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
    requestModel: string;
    serverAddress: string;
    isChatSession?: boolean;
  }): Promise<any> {
    let metricParams;
    try {
      metricParams = await VertexAIWrapper._commonSetter({
        args,
        genAIEndpoint,
        result: response,
        span,
        requestModel,
        serverAddress,
        isChatSession,
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

  static async *_streamGenerator({
    args,
    genAIEndpoint,
    stream,
    span,
    requestModel,
    serverAddress,
    isChatSession = false,
  }: {
    args: any[];
    genAIEndpoint: string;
    stream: any;
    span: Span;
    requestModel: string;
    serverAddress: string;
    isChatSession?: boolean;
  }): AsyncGenerator<unknown, any, unknown> {
    let metricParams;
    const timestamps: number[] = [];
    const startTime = Date.now();

    try {
      const accumulated = {
        text: '',
        candidates: [] as any[],
        usageMetadata: {
          promptTokenCount: 0,
          candidatesTokenCount: 0,
          totalTokenCount: 0,
          cachedContentTokenCount: 0,
          cacheCreationInputTokens: 0,
        },
        functionCall: null as any,
      };

      for await (const chunk of stream) {
        timestamps.push(Date.now());

        if (chunk.candidates && chunk.candidates.length > 0) {
          if (accumulated.candidates.length === 0) {
            accumulated.candidates = chunk.candidates.map((c: any) => ({
              content: { parts: [{ text: '' }], role: 'model' },
              finishReason: c.finishReason || '',
            }));
          }
          chunk.candidates.forEach((c: any, idx: number) => {
            if (c.content?.parts) {
              c.content.parts.forEach((part: any) => {
                if (part.text && accumulated.candidates[idx]) {
                  accumulated.candidates[idx].content.parts[0].text += part.text;
                  accumulated.text += part.text;
                }
                if (part.functionCall) {
                  accumulated.functionCall = part.functionCall;
                }
              });
            }
            if (c.finishReason && accumulated.candidates[idx]) {
              accumulated.candidates[idx].finishReason = c.finishReason;
            }
          });
        }

        if (chunk.usageMetadata) {
          const u = chunk.usageMetadata;
          accumulated.usageMetadata = {
            promptTokenCount: u.promptTokenCount || accumulated.usageMetadata.promptTokenCount,
            candidatesTokenCount: u.candidatesTokenCount || accumulated.usageMetadata.candidatesTokenCount,
            totalTokenCount: u.totalTokenCount || accumulated.usageMetadata.totalTokenCount,
            cachedContentTokenCount: u.cachedContentTokenCount || accumulated.usageMetadata.cachedContentTokenCount,
            cacheCreationInputTokens: u.cacheCreationInputTokens || accumulated.usageMetadata.cacheCreationInputTokens,
          };
        }

        yield chunk;
      }

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const diffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = diffs.reduce((a, b) => a + b, 0) / diffs.length / 1000;
      }

      metricParams = await VertexAIWrapper._commonSetter({
        args,
        genAIEndpoint,
        result: accumulated,
        span,
        requestModel,
        serverAddress,
        ttft,
        tbt,
        isStream: true,
        isChatSession,
      });

      return accumulated;
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

  static async _commonSetter({
    args,
    genAIEndpoint,
    result,
    span,
    requestModel,
    serverAddress,
    ttft = 0,
    tbt = 0,
    isStream = false,
    isChatSession = false,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    requestModel: string;
    serverAddress: string;
    ttft?: number;
    tbt?: number;
    isStream?: boolean;
    isChatSession?: boolean;
  }) {
    const captureContent = OpenlitConfig.captureMessageContent;
    // Non-streaming: result = {response: GenerateContentResponse}
    // Streaming: result = accumulated plain object
    const responseData = result.response || result;

    // @google-cloud/vertexai uses `generationConfig` (camelCase).
    // ChatSession.sendMessage only accepts the message content as args[0]
    // (string | Array<string | Part>) — there is no per-call generationConfig
    // argument. Per-session config is set once via GenerativeModel.startChat().
    const requestArg = isChatSession ? {} : (args[0] || {});
    const generationConfig = requestArg.generationConfig || {};
    const {
      temperature,
      maxOutputTokens,
      topP,
      topK,
      stopSequences,
      frequencyPenalty,
      presencePenalty,
      candidateCount,
    } = generationConfig;
    const systemInstruction = requestArg.systemInstruction;
    const _tools = requestArg.tools;

    // Request param attributes — only set when explicitly provided
    if (temperature != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    if (maxOutputTokens != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, maxOutputTokens);
    if (topP != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, topP);
    if (topK != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, topK);
    if (stopSequences) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, stopSequences);
    if (frequencyPenalty) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, frequencyPenalty);
    if (presencePenalty) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, presencePenalty);
    if (candidateCount != null && candidateCount !== 1) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, candidateCount);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, isStream);

    const usageMetadata = responseData.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;
    const cacheReadTokens = usageMetadata?.cachedContentTokenCount || 0;
    const cacheCreationTokens = usageMetadata?.cacheCreationInputTokens || 0;

    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);

    VertexAIWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user: undefined,
      cost,
      aiSystem: VertexAIWrapper.aiSystem,
      serverAddress,
      serverPort: VertexAIWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, requestModel);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);

    if (cacheReadTokens) span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheReadTokens);
    if (cacheCreationTokens) span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheCreationTokens);

    if (ttft > 0) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    if (tbt > 0) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);

    const responseId = responseData.id || responseData.name || '';
    if (responseId) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, responseId);
    }

    const finishReason = responseData.candidates?.[0]?.finishReason || '';
    if (finishReason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
    }

    // Resolve completion text
    const completionText = isStream
      ? (responseData.text || '')
      : (responseData.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || '');
    span.setAttribute(
      SemanticConvention.GEN_AI_OUTPUT_TYPE,
      typeof completionText === 'string'
        ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
        : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON
    );
    const outputType = typeof completionText === 'string'
      ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;

    const functionCall = isStream
      ? responseData.functionCall
      : responseData.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)?.functionCall;
    if (functionCall) {
      if (functionCall.name) span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, functionCall.name);
      if (functionCall.args) span.setAttribute(SemanticConvention.GEN_AI_TOOL_ARGS, JSON.stringify(functionCall.args));
    }

    const toolDefinitionsJson = OpenLitHelper.buildToolDefinitions(
      Array.isArray(_tools)
        ? _tools.flatMap((tool: any) =>
            Array.isArray(tool?.functionDeclarations) ? tool.functionDeclarations : [tool]
          )
        : _tools
    );

    // System instructions — computed regardless of captureContent for agent version hash
    let systemInstructionsJson: string | undefined;
    if (systemInstruction) {
      let systemText = '';
      if (typeof systemInstruction === 'string') {
        systemText = systemInstruction;
      } else if (Array.isArray(systemInstruction.parts)) {
        systemText = systemInstruction.parts
          .map((p: any) => p?.text || '')
          .filter(Boolean)
          .join('\n');
      } else if (typeof systemInstruction.text === 'string') {
        systemText = systemInstruction.text;
      }
      if (systemText) {
        systemInstructionsJson = JSON.stringify([{ type: 'text', content: systemText }]);
      }
    }

    const versionExtras = VertexAIWrapper._stampAgentVersion(span, {
      systemInstructionsJson,
      toolDefinitionsJson,
      primaryModel: requestModel,
      temperature: temperature ?? null,
      top_p: topP ?? null,
      max_tokens: maxOutputTokens ?? null,
    });

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;

    if (captureContent) {
      if (!isChatSession) {
        const contents = requestArg.contents;
        let messages: any[] = [];
        if (typeof contents === 'string') {
          messages = [{ role: 'user', content: contents }];
        } else if (Array.isArray(contents)) {
          messages = contents.map((item: any) => ({
            role: item.role === 'model' ? 'assistant' : (item.role || 'user'),
            content: Array.isArray(item.parts)
              ? item.parts.map((p: any) => p.text || '').join(' ')
              : String(item.parts || ''),
          }));
        }
        inputMessagesJson = OpenLitHelper.buildInputMessages(messages);
        span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
      } else {
        // ChatSession: capture the current turn message (args[0] can be string or Part[])
        const turnMessage = args[0];
        const turnText =
          typeof turnMessage === 'string'
            ? turnMessage
            : Array.isArray(turnMessage)
              ? turnMessage.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join(' ')
              : '';
        inputMessagesJson = OpenLitHelper.buildInputMessages([{ role: 'user', content: turnText }]);
        span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
      }

      const outputContent = completionText || responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const toolCallsForOutput = functionCall
        ? [{ name: functionCall.name || '', arguments: functionCall.args || {} }]
        : undefined;
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        outputContent,
        finishReason || 'stop',
        toolCallsForOutput
      );
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);

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
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: requestModel,
        [SemanticConvention.SERVER_ADDRESS]: serverAddress,
        [SemanticConvention.SERVER_PORT]: VertexAIWrapper.serverPort,
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
        ...versionExtras,
      };
      if (responseId) eventAttrs[SemanticConvention.GEN_AI_RESPONSE_ID] = responseId;
      if (finishReason) eventAttrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = [finishReason];
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
      user: undefined,
      cost,
      aiSystem: VertexAIWrapper.aiSystem,
      serverAddress,
      serverPort: VertexAIWrapper.serverPort,
    };
  }
}

export default VertexAIWrapper;
