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
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: ElevenLabsWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: serverAddress,
    [SemanticConvention.SERVER_PORT]: serverPort,
  };
}

class ElevenLabsWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_ELEVENLABS;
  static serverAddress = 'api.elevenlabs.io';
  static serverPort = 443;

  static _patchConvert(tracer: Tracer, methodName: string): any {
    const genAIEndpoint = `elevenlabs.textToSpeech.${methodName}`;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);

        const voiceId = typeof args[0] === 'string' ? args[0] : (args[0]?.voice_id || '');
        const options = (typeof args[0] === 'object' && args[0] !== null) ? args[0] : (args[1] || {});
        const requestModel = options.model_id || options.model || 'eleven_multilingual_v2';

        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(
            SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
            requestModel,
            ElevenLabsWrapper.serverAddress,
            ElevenLabsWrapper.serverPort
          ),
        }, effectiveCtx);

        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          let metricParams;
          try {
            const response = await originalMethod.apply(this, args);

            metricParams = ElevenLabsWrapper._commonAudioSetter({
              args,
              genAIEndpoint,
              span,
              isStream: false,
            });

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: ElevenLabsWrapper.aiSystem,
              serverAddress: ElevenLabsWrapper.serverAddress,
              serverPort: ElevenLabsWrapper.serverPort,
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

  static _patchStream(tracer: Tracer, methodName: string): any {
    const genAIEndpoint = `elevenlabs.textToSpeech.${methodName}`;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);

        const voiceId = typeof args[0] === 'string' ? args[0] : (args[0]?.voice_id || '');
        const options = (typeof args[0] === 'object' && args[0] !== null) ? args[0] : (args[1] || {});
        const requestModel = options.model_id || options.model || 'eleven_multilingual_v2';

        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(
            SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
            requestModel,
            ElevenLabsWrapper.serverAddress,
            ElevenLabsWrapper.serverPort
          ),
        }, effectiveCtx);

        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          try {
            const response = await originalMethod.apply(this, args);

            return OpenLitHelper.createStreamProxy(
              response,
              ElevenLabsWrapper._streamGenerator({
                args,
                genAIEndpoint,
                response,
                span,
              })
            );
          } catch (e: any) {
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
          }
        });
      };
    };
  }

  static async *_streamGenerator({
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
      for await (const chunk of response) {
        timestamps.push(Date.now());
        yield chunk;
      }

      const voiceId = typeof args[0] === 'string' ? args[0] : (args[0]?.voice_id || '');
      const options = (typeof args[0] === 'object' && args[0] !== null) ? args[0] : (args[1] || {});
      const requestModel = options.model_id || options.model || 'eleven_multilingual_v2';

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = ElevenLabsWrapper._commonAudioSetter({
        args,
        genAIEndpoint,
        span,
        ttft,
        tbt,
        isStream: true,
      });
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

  static _commonAudioSetter({
    args,
    genAIEndpoint,
    span,
    ttft = 0,
    tbt = 0,
    isStream = false,
  }: {
    args: any[];
    genAIEndpoint: string;
    span: Span;
    ttft?: number;
    tbt?: number;
    isStream?: boolean;
  }): BaseSpanAttributes {
    const captureContent = OpenlitConfig.captureMessageContent;

    const voiceId = typeof args[0] === 'string' ? args[0] : (args[0]?.voice_id || '');
    const options = (typeof args[0] === 'object' && args[0] !== null) ? args[0] : (args[1] || {});
    const text = options.text || '';
    const requestModel = options.model_id || options.model || 'eleven_multilingual_v2';
    const voiceSettings = options.voice_settings || '';
    const outputFormat = options.output_format || 'mp3_44100_128';

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE, voiceId);
    if (voiceSettings) {
      span.setAttribute(
        SemanticConvention.GEN_AI_REQUEST_AUDIO_SETTINGS,
        typeof voiceSettings === 'object' ? JSON.stringify(voiceSettings) : String(voiceSettings)
      );
    }
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputFormat);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, isStream);

    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 0);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 0);

    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

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

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;

    if (captureContent) {
      const inputMessages = [{ role: 'user', parts: [{ type: 'text', content: String(text) }] }];
      const outputMessages = [{ role: 'assistant', parts: [{ type: 'text', content: '[audio generated]' }], finish_reason: 'stop' }];

      inputMessagesJson = JSON.stringify(inputMessages);
      outputMessagesJson = JSON.stringify(outputMessages);

      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
    }

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
      aiSystem: ElevenLabsWrapper.aiSystem,
    };
  }
}

export default ElevenLabsWrapper;
