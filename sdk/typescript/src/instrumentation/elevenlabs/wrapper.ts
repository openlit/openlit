import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

function spanCreationAttrs(requestModel: string): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_ELEVENLABS,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: ElevenLabsWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: ElevenLabsWrapper.serverPort,
  };
}

class ElevenLabsWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_ELEVENLABS;
  static serverAddress = 'api.elevenlabs.io';
  static serverPort = 443;

  /**
   * Patch `client.textToSpeech.convert(voiceId, params)`.
   * Signature: convert(voice_id: string, params: { text, model_id?, output_format?, voice_settings?, ... })
   */
  static _patchTextToSpeechConvert(tracer: Tracer): any {
    const genAIEndpoint = 'elevenlabs.text_to_speech';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        // args[0] = voiceId (string), args[1] = params object
        const voiceId: string = typeof args[0] === 'string' ? args[0] : '';
        const params: any = args[1] || {};
        const requestModel: string =
          params.model_id || params.model || 'eleven_multilingual_v2';

        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} ${requestModel}`;
        const effectiveCtx = context.active();
        const span = tracer.startSpan(
          spanName,
          { kind: SpanKind.CLIENT, attributes: spanCreationAttrs(requestModel) },
          effectiveCtx
        );

        return context
          .with(trace.setSpan(effectiveCtx, span), () => originalMethod.apply(this, args))
          .then((response: any) =>
            ElevenLabsWrapper._handleAudioResponse({
              span,
              genAIEndpoint,
              voiceId,
              params,
              requestModel,
              response,
            })
          )
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: ElevenLabsWrapper.aiSystem,
              serverAddress: ElevenLabsWrapper.serverAddress,
              serverPort: ElevenLabsWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  /**
   * Patch `client.generate({ text, voice, model, ... })`.
   * Older / convenience API on the client itself.
   */
  static _patchGenerate(tracer: Tracer): any {
    const genAIEndpoint = 'elevenlabs.generate';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const params: any = args[0] || {};
        const voiceId: string =
          typeof params.voice === 'string'
            ? params.voice
            : typeof params.voice_id === 'string'
            ? params.voice_id
            : '';
        const requestModel: string =
          params.model || params.model_id || 'eleven_multilingual_v2';

        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} ${requestModel}`;
        const effectiveCtx = context.active();
        const span = tracer.startSpan(
          spanName,
          { kind: SpanKind.CLIENT, attributes: spanCreationAttrs(requestModel) },
          effectiveCtx
        );

        return context
          .with(trace.setSpan(effectiveCtx, span), () => originalMethod.apply(this, args))
          .then((response: any) =>
            ElevenLabsWrapper._handleAudioResponse({
              span,
              genAIEndpoint,
              voiceId,
              params,
              requestModel,
              response,
            })
          )
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: ElevenLabsWrapper.aiSystem,
              serverAddress: ElevenLabsWrapper.serverAddress,
              serverPort: ElevenLabsWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static async _handleAudioResponse({
    span,
    genAIEndpoint,
    voiceId,
    params,
    requestModel,
    response,
  }: {
    span: Span;
    genAIEndpoint: string;
    voiceId: string;
    params: any;
    requestModel: string;
    response: any;
  }): Promise<any> {
    let metricParams;
    try {
      const captureContent = OpenlitConfig.captureMessageContent;
      const text: string = params.text || params.input || '';
      const outputFormat: string = params.output_format || params.outputFormat || 'mp3_44100_128';
      const voiceSettings = params.voice_settings || params.voiceSettings;

      // Audio cost is based on character count (same as Python: get_audio_model_cost)
      const pricingInfo = OpenlitConfig.pricingInfo || {};
      const cost = OpenLitHelper.getAudioModelCost(requestModel, pricingInfo, text);

      ElevenLabsWrapper.setBaseSpanAttributes(span, {
        genAIEndpoint,
        model: requestModel,
        cost,
        aiSystem: ElevenLabsWrapper.aiSystem,
        serverAddress: ElevenLabsWrapper.serverAddress,
        serverPort: ElevenLabsWrapper.serverPort,
      });

      // Request attributes
      if (voiceId) {
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE, voiceId);
      }
      if (voiceSettings) {
        span.setAttribute(
          SemanticConvention.GEN_AI_REQUEST_AUDIO_SETTINGS,
          JSON.stringify(voiceSettings)
        );
      }
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

      // Response attributes
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputFormat);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 0);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 0);
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, requestModel);

      // Content capture
      let inputMessagesJson: string | undefined;
      let outputMessagesJson: string | undefined;
      if (captureContent) {
        inputMessagesJson = OpenLitHelper.buildInputMessages([
          { role: 'user', content: text },
        ]);
        outputMessagesJson = OpenLitHelper.buildOutputMessages('[audio generated]', 'stop');
        span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      }

      // Emit inference event
      if (!OpenlitConfig.disableEvents) {
        const eventAttrs: Attributes = {
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
          [SemanticConvention.GEN_AI_RESPONSE_MODEL]: requestModel,
          [SemanticConvention.SERVER_ADDRESS]: ElevenLabsWrapper.serverAddress,
          [SemanticConvention.SERVER_PORT]: ElevenLabsWrapper.serverPort,
          [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputFormat,
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: 0,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: 0,
          [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: ['stop'],
        };
        if (captureContent) {
          if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
          if (outputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
        }
        OpenLitHelper.emitInferenceEvent(span, eventAttrs);
      }

      metricParams = {
        genAIEndpoint,
        model: requestModel,
        cost,
        aiSystem: ElevenLabsWrapper.aiSystem,
        serverAddress: ElevenLabsWrapper.serverAddress,
        serverPort: ElevenLabsWrapper.serverPort,
      };

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
}

export default ElevenLabsWrapper;
