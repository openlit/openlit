import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  isFrameworkLlmActive,
  getFrameworkParentContext,
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
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: AssemblyAIWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: serverAddress,
    [SemanticConvention.SERVER_PORT]: serverPort,
  };
}

class AssemblyAIWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_ASSEMBLYAI;
  static serverAddress = 'api.assemblyai.com';
  static serverPort = 443;

  /**
   * Parse the request arguments of `client.transcripts.transcribe` / `submit` / `get`.
   * AssemblyAI accepts either a params object (`{ audio, speechModel, ... }`) or, for
   * `get`, a transcript id string. Mirrors the Python instrumentor which reads
   * `speech_model` from kwargs (default "best").
   */
  static _parseAudioArgs(args: any[]): {
    options: Record<string, any>;
    requestModel: string;
    audioUrl: string;
  } {
    const options =
      typeof args[0] === 'object' && args[0] !== null ? args[0] : {};
    const requestModel =
      options.speechModel || options.speech_model || 'best';
    const audioUrl =
      typeof args[0] === 'string'
        ? args[0]
        : options.audio || options.audioUrl || options.audio_url || '';

    return { options, requestModel, audioUrl: String(audioUrl) };
  }

  static _patchTranscribe(tracer: Tracer, methodName: string, sdkVersion?: string): any {
    const genAIEndpoint = `assemblyai.transcripts.${methodName}`;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);

        const { requestModel } = AssemblyAIWrapper._parseAudioArgs(args);

        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(
          spanName,
          {
            kind: SpanKind.CLIENT,
            attributes: spanCreationAttrs(
              SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
              requestModel,
              AssemblyAIWrapper.serverAddress,
              AssemblyAIWrapper.serverPort
            ),
          },
          effectiveCtx
        );

        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          let metricParams;
          const startTime = Date.now();
          try {
            const response = await originalMethod.apply(this, args);
            const ttft = (Date.now() - startTime) / 1000;

            metricParams = AssemblyAIWrapper._commonAudioSetter({
              args,
              genAIEndpoint,
              response,
              span,
              ttft,
              tbt: 0,
              isStream: false,
              sdkVersion,
            });

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: AssemblyAIWrapper.aiSystem,
              serverAddress: AssemblyAIWrapper.serverAddress,
              serverPort: AssemblyAIWrapper.serverPort,
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

  static _commonAudioSetter({
    args,
    genAIEndpoint,
    response,
    span,
    ttft = 0,
    tbt = 0,
    isStream = false,
    sdkVersion,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
    ttft?: number;
    tbt?: number;
    isStream?: boolean;
    sdkVersion?: string;
  }): BaseSpanAttributes {
    const captureContent = OpenlitConfig.captureMessageContent;

    const { requestModel, audioUrl } = AssemblyAIWrapper._parseAudioArgs(args);

    // Prefer values from the returned Transcript (matches the Python instrumentor,
    // which reads audio_url / audio_duration / id / text off the response).
    const prompt = response?.audio_url ?? response?.audioUrl ?? audioUrl ?? '';
    const audioDuration =
      response?.audio_duration ?? response?.audioDuration ?? 0;
    const responseId = response?.id ?? '';
    const responseText = response?.text ?? '';

    // Request parameters
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_DURATION, audioDuration);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, isStream);

    // Response parameters
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, 'text');
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, responseId);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);

    // Token usage (AssemblyAI transcription does not report token usage)
    const usage = response?.usage;
    const inputTokens = (usage && (usage.input_tokens ?? usage.inputTokens)) || 0;
    const outputTokens = (usage && (usage.output_tokens ?? usage.outputTokens)) || 0;
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, inputTokens + outputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 0);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, 0);
    span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);

    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getAudioModelCost(requestModel, pricingInfo, prompt);

    AssemblyAIWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      cost,
      aiSystem: AssemblyAIWrapper.aiSystem,
      serverAddress: AssemblyAIWrapper.serverAddress,
      serverPort: AssemblyAIWrapper.serverPort,
    });

    // Python stamps gen_ai.system and the AssemblyAI package version (not OpenLIT's).
    span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, AssemblyAIWrapper.aiSystem);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, requestModel);
    if (sdkVersion) {
      span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, sdkVersion);
    }

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;

    if (captureContent) {
      inputMessagesJson = OpenLitHelper.buildInputMessages([{ role: 'user', content: prompt }]);
      outputMessagesJson = OpenLitHelper.buildOutputMessages(responseText, 'stop');

      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: requestModel,
        [SemanticConvention.SERVER_ADDRESS]: AssemblyAIWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: AssemblyAIWrapper.serverPort,
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: 'text',
        [SemanticConvention.GEN_AI_RESPONSE_ID]: responseId,
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
      aiSystem: AssemblyAIWrapper.aiSystem,
      serverAddress: AssemblyAIWrapper.serverAddress,
      serverPort: AssemblyAIWrapper.serverPort,
    };
  }
}

export default AssemblyAIWrapper;
