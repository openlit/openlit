import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  isFrameworkLlmActive,
  getFrameworkParentContext,
} from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

type ElevenLabsRequest = {
  voiceId?: string;
  body: Record<string, any>;
  text: string;
  requestModel: string;
  outputFormat: string;
  voiceSettings?: unknown;
  isStream: boolean;
};

function spanCreationAttrs(
  operationName: string,
  requestModel: string
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: ElevenLabsWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: ElevenLabsWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: ElevenLabsWrapper.serverPort,
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function stringifyAttribute(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

class ElevenLabsWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_ELEVENLABS;
  static serverAddress = 'api.elevenlabs.io';
  static serverPort = 443;

  static _patchTextToSpeech(tracer: Tracer, methodName: string): any {
    const genAIEndpoint = 'elevenlabs.text_to_speech';
    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);

        const request = ElevenLabsWrapper._requestFromArgs(args, methodName);
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} ${request.requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = ElevenLabsWrapper._startSpan(
          tracer,
          spanName,
          request.requestModel,
          effectiveCtx
        );

        try {
          const result = context.with(trace.setSpan(effectiveCtx, span), () => {
            return originalMethod.apply(this, args);
          });
          return ElevenLabsWrapper._wrapResult({
            result,
            args,
            genAIEndpoint,
            methodName,
            span,
            request,
          });
        } catch (e: any) {
          ElevenLabsWrapper._handleError({
            error: e,
            genAIEndpoint,
            requestModel: request.requestModel,
            span,
          });
        }
      };
    };
  }

  static _patchGenerate(tracer: Tracer): any {
    return ElevenLabsWrapper._patchTextToSpeech(tracer, 'generate');
  }

  static _patchConvert(tracer: Tracer, methodName: string): any {
    return ElevenLabsWrapper._patchTextToSpeech(tracer, methodName);
  }

  private static _startSpan(
    tracer: Tracer,
    spanName: string,
    requestModel: string,
    activeContext: any
  ): Span {
    return tracer.startSpan(
      spanName,
      {
        kind: SpanKind.CLIENT,
        attributes: spanCreationAttrs(
          SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
          requestModel
        ),
      },
      activeContext
    );
  }

  static _requestFromArgs(args: any[], methodName: string): ElevenLabsRequest {
    const first = args[0];
    const second = args[1];
    const isGenerateRequest =
      methodName === 'generate' &&
      first &&
      typeof first === 'object' &&
      !Array.isArray(first);

    const body = (isGenerateRequest ? first : second) || {};
    const voiceId = isGenerateRequest
      ? firstString(body.voiceId, body.voice_id, body.voice)
      : firstString(first, body.voiceId, body.voice_id, body.voice);

    const requestModel =
      firstString(body.model, body.modelId, body.model_id) || DEFAULT_MODEL;
    const outputFormat =
      firstString(body.outputFormat, body.output_format) || DEFAULT_OUTPUT_FORMAT;
    const text = firstString(body.text, body.input, body.prompt) || '';
    const isStream =
      body.stream === true ||
      methodName === 'stream' ||
      methodName === 'convertAsStream' ||
      methodName === 'streamWithTimestamps';

    return {
      voiceId,
      body,
      text,
      requestModel,
      outputFormat,
      voiceSettings: body.voiceSettings ?? body.voice_settings,
      isStream,
    };
  }

  private static _wrapResult({
    result,
    args,
    genAIEndpoint,
    methodName,
    span,
    request,
  }: {
    result: any;
    args: any[];
    genAIEndpoint: string;
    methodName: string;
    span: Span;
    request: ElevenLabsRequest;
  }): any {
    if (
      result &&
      typeof result.withRawResponse === 'function' &&
      typeof result.constructor?.fromPromise === 'function'
    ) {
      const rawPromise = result.withRawResponse()
        .then(async (rawResponse: any) => {
          const response = rawResponse?.data ?? rawResponse;
          await ElevenLabsWrapper._textToSpeech({
            args,
            genAIEndpoint,
            methodName,
            response,
            span,
          });
          return rawResponse;
        })
        .catch((e: any) => {
          ElevenLabsWrapper._handleError({
            error: e,
            genAIEndpoint,
            requestModel: request.requestModel,
            span,
          });
        });
      return result.constructor.fromPromise(rawPromise);
    }

    if (result && typeof result.then === 'function') {
      return result
        .then(async (response: any) => {
          await ElevenLabsWrapper._textToSpeech({
            args,
            genAIEndpoint,
            methodName,
            response,
            span,
          });
          return response;
        })
        .catch((e: any) => {
          ElevenLabsWrapper._handleError({
            error: e,
            genAIEndpoint,
            requestModel: request.requestModel,
            span,
          });
        });
    }

    ElevenLabsWrapper._textToSpeech({
      args,
      genAIEndpoint,
      methodName,
      response: result,
      span,
    });
    return result;
  }

  static async _textToSpeech({
    args,
    genAIEndpoint,
    methodName,
    response,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    methodName: string;
    response: any;
    span: Span;
  }): Promise<any> {
    let metricParams: BaseSpanAttributes | undefined;
    try {
      const request = ElevenLabsWrapper._requestFromArgs(args, methodName);
      const captureContent = OpenlitConfig.captureMessageContent;
      const responseModel =
        firstString(response?.model, response?.modelId, response?.model_id) ||
        request.requestModel;
      const pricingInfo = OpenlitConfig.pricingInfo || {};
      const cost = OpenLitHelper.getAudioModelCost(
        responseModel,
        pricingInfo,
        request.text
      );

      ElevenLabsWrapper.setBaseSpanAttributes(span, {
        genAIEndpoint,
        model: request.requestModel,
        cost,
        aiSystem: ElevenLabsWrapper.aiSystem,
        serverAddress: ElevenLabsWrapper.serverAddress,
        serverPort: ElevenLabsWrapper.serverPort,
      });

      span.setAttribute(
        SemanticConvention.GEN_AI_OPERATION,
        SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO
      );
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, request.isStream);
      span.setAttribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_SPEECH
      );
      span.setAttribute(
        SemanticConvention.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT,
        request.outputFormat
      );
      span.setAttribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['stop']
      );

      if (request.voiceId) {
        span.setAttribute(
          SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE,
          request.voiceId
        );
      }

      const voiceSettings = stringifyAttribute(request.voiceSettings);
      if (voiceSettings) {
        span.setAttribute(
          SemanticConvention.GEN_AI_REQUEST_AUDIO_SETTINGS,
          voiceSettings
        );
      }

      let inputMessagesJson: string | undefined;
      let outputMessagesJson: string | undefined;
      if (captureContent) {
        inputMessagesJson = OpenLitHelper.buildInputMessages(
          request.text ? [{ role: 'user', content: request.text }] : []
        );
        outputMessagesJson = OpenLitHelper.buildOutputMessages('[audio generated]', 'stop');
        span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      }

      if (!OpenlitConfig.disableEvents) {
        const eventAttrs: Attributes = {
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: request.requestModel,
          [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
          [SemanticConvention.SERVER_ADDRESS]: ElevenLabsWrapper.serverAddress,
          [SemanticConvention.SERVER_PORT]: ElevenLabsWrapper.serverPort,
          [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: ['stop'],
          [SemanticConvention.GEN_AI_OUTPUT_TYPE]: SemanticConvention.GEN_AI_OUTPUT_TYPE_SPEECH,
          [SemanticConvention.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT]: request.outputFormat,
        };
        if (request.voiceId) {
          eventAttrs[SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE] = request.voiceId;
        }
        if (voiceSettings) {
          eventAttrs[SemanticConvention.GEN_AI_REQUEST_AUDIO_SETTINGS] = voiceSettings;
        }
        if (captureContent) {
          if (inputMessagesJson) {
            eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
          }
          if (outputMessagesJson) {
            eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
          }
        }
        OpenLitHelper.emitInferenceEvent(span, eventAttrs);
      }

      metricParams = {
        genAIEndpoint,
        model: request.requestModel,
        cost,
        aiSystem: ElevenLabsWrapper.aiSystem,
        serverAddress: ElevenLabsWrapper.serverAddress,
        serverPort: ElevenLabsWrapper.serverPort,
      };

      return response;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
      return response;
    } finally {
      span.end();
      if (metricParams) {
        BaseWrapper.recordMetrics(span, metricParams);
      }
    }
  }

  private static _handleError({
    error,
    genAIEndpoint,
    requestModel,
    span,
  }: {
    error: any;
    genAIEndpoint: string;
    requestModel: string;
    span: Span;
  }): never {
    OpenLitHelper.handleException(span, error);
    BaseWrapper.recordMetrics(span, {
      genAIEndpoint,
      model: requestModel,
      aiSystem: ElevenLabsWrapper.aiSystem,
      serverAddress: ElevenLabsWrapper.serverAddress,
      serverPort: ElevenLabsWrapper.serverPort,
      errorType: error?.constructor?.name || '_OTHER',
    });
    span.end();
    throw error;
  }
}

export default ElevenLabsWrapper;
