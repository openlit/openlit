import { Span, trace } from '@opentelemetry/api';
import ElevenLabsWrapper from '../elevenlabs/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('ElevenLabsWrapper', () => {
  let span: Span;

  beforeEach(() => {
    span = mockTracer.startSpan('test-span');
    span.setAttribute = jest.fn();
    span.addEvent = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    span.end();
  });

  describe('_parseAudioArgs', () => {
    it('should parse voice id and options from positional args', () => {
      const parsed = ElevenLabsWrapper._parseAudioArgs([
        'voice-id-123',
        {
          text: 'Hello world',
          model_id: 'eleven_turbo_v2',
          voice_settings: { stability: 0.5 },
          output_format: 'pcm_16000',
        },
      ]);

      expect(parsed).toEqual({
        voiceId: 'voice-id-123',
        options: {
          text: 'Hello world',
          model_id: 'eleven_turbo_v2',
          voice_settings: { stability: 0.5 },
          output_format: 'pcm_16000',
        },
        requestModel: 'eleven_turbo_v2',
        text: 'Hello world',
        voiceSettings: { stability: 0.5 },
        outputFormat: 'pcm_16000',
      });
    });

    it('should parse voice id and options from a single object arg', () => {
      const parsed = ElevenLabsWrapper._parseAudioArgs([
        {
          voice_id: 'voice-id-456',
          text: 'Nested args',
          model: 'eleven_monolingual_v1',
        },
      ]);

      expect(parsed.voiceId).toBe('voice-id-456');
      expect(parsed.requestModel).toBe('eleven_monolingual_v1');
      expect(parsed.text).toBe('Nested args');
    });
  });

  describe('_commonAudioSetter', () => {
    it('should set span attributes and return metric parameters', () => {
      const mockArgs = [
        'voice-id-123',
        {
          text: 'Hello world',
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.75, similarity_boost: 0.85 },
          output_format: 'mp3_44100_128',
        },
      ];

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      (OpenlitConfig as any).captureMessageContent = true;
      jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0.005);

      const metricParams = ElevenLabsWrapper._commonAudioSetter({
        args: mockArgs,
        genAIEndpoint: 'elevenlabs.textToSpeech.convert',
        span,
        isStream: false,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE,
        'voice-id-123'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_AUDIO_SETTINGS,
        JSON.stringify({ stability: 0.75, similarity_boost: 0.85 })
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        'mp3_44100_128'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
        false
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
        0
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
        0
      );

      // Check messages are set
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'Hello world' }] }])
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: '[audio generated]' }], finish_reason: 'stop' }])
      );

      expect(metricParams).toEqual({
        genAIEndpoint: 'elevenlabs.textToSpeech.convert',
        model: 'eleven_multilingual_v2',
        cost: 0.005,
        aiSystem: 'elevenlabs',
      });
    });

    it('should not set message content if captureMessageContent is false', () => {
      const mockArgs = [
        'voice-id-123',
        {
          text: 'Hello world',
        },
      ];

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      (OpenlitConfig as any).captureMessageContent = false;
      jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0.005);

      ElevenLabsWrapper._commonAudioSetter({
        args: mockArgs,
        genAIEndpoint: 'elevenlabs.textToSpeech.convert',
        span,
        isStream: false,
      });

      expect(span.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        expect.any(String)
      );
      expect(span.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        expect.any(String)
      );
    });

    it('should emit inference event if disableEvents is false', () => {
      const mockArgs = [
        'voice-id-123',
        {
          text: 'Hello world',
        },
      ];

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = false;
      (OpenlitConfig as any).captureMessageContent = true;
      jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0.005);

      const spyEmit = jest.spyOn(OpenLitHelper, 'emitInferenceEvent');

      ElevenLabsWrapper._commonAudioSetter({
        args: mockArgs,
        genAIEndpoint: 'elevenlabs.textToSpeech.convert',
        span,
        isStream: false,
      });

      expect(spyEmit).toHaveBeenCalledWith(span, expect.objectContaining({
        [SemanticConvention.GEN_AI_OPERATION]: 'audio',
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'eleven_multilingual_v2',
      }));
    });
  });

  describe('_streamGenerator', () => {
    it('should yield chunks and call metric/setter methods', async () => {
      const mockArgs = [
        'voice-id-123',
        {
          text: 'Hello world streaming',
          model_id: 'eleven_multilingual_v2',
        },
      ];

      const mockResponse = (async function* () {
        yield Buffer.from('chunk1');
        yield Buffer.from('chunk2');
      })();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0.005);

      jest.spyOn(ElevenLabsWrapper, '_commonAudioSetter').mockReturnValue({
        genAIEndpoint: 'elevenlabs.textToSpeech.stream',
        model: 'eleven_multilingual_v2',
        cost: 0.005,
        aiSystem: 'elevenlabs',
      });

      const generator = ElevenLabsWrapper._streamGenerator({
        args: mockArgs,
        genAIEndpoint: 'elevenlabs.textToSpeech.stream',
        response: mockResponse,
        span,
      });

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(ElevenLabsWrapper._commonAudioSetter).toHaveBeenCalledWith(expect.objectContaining({
        args: mockArgs,
        genAIEndpoint: 'elevenlabs.textToSpeech.stream',
        span,
        isStream: true,
        ttft: expect.any(Number),
        tbt: expect.any(Number),
      }));

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(span, {
        genAIEndpoint: 'elevenlabs.textToSpeech.stream',
        model: 'eleven_multilingual_v2',
        cost: 0.005,
        aiSystem: 'elevenlabs',
      });
    });

    it('should record error metrics when streaming fails', async () => {
      const mockArgs = [
        'voice-id-123',
        {
          text: 'Hello world streaming',
          model_id: 'eleven_multilingual_v2',
        },
      ];

      const mockResponse = (async function* () {
        yield Buffer.from('chunk1');
        throw new Error('stream failed');
      })();

      const generator = ElevenLabsWrapper._streamGenerator({
        args: mockArgs,
        genAIEndpoint: 'elevenlabs.textToSpeech.stream',
        response: mockResponse,
        span,
      });

      await expect(async () => {
        for await (const _chunk of generator) {
          // consume until error
        }
      }).rejects.toThrow('stream failed');

      expect(OpenLitHelper.handleException).toHaveBeenCalledWith(span, expect.any(Error));
      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(span, {
        genAIEndpoint: 'elevenlabs.textToSpeech.stream',
        model: 'eleven_multilingual_v2',
        aiSystem: 'elevenlabs',
        serverAddress: 'api.elevenlabs.io',
        serverPort: 443,
        errorType: 'Error',
      });
    });
  });
});
