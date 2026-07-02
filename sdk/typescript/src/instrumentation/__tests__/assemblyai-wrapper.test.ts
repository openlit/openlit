import { Span, trace } from '@opentelemetry/api';
import AssemblyAIWrapper from '../assemblyai/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('AssemblyAIWrapper', () => {
  let span: Span;

  beforeEach(() => {
    span = mockTracer.startSpan('test-span');
    span.setAttribute = jest.fn();
    span.addEvent = jest.fn();
    jest.clearAllMocks();

    (OpenLitHelper as any).buildInputMessages = jest
      .fn()
      .mockImplementation((messages: Array<{ role: string; content: string }>) =>
        JSON.stringify(
          messages.map((m) => ({
            role: m.role,
            parts: [{ type: 'text', content: m.content }],
          }))
        )
      );
    (OpenLitHelper as any).buildOutputMessages = jest
      .fn()
      .mockImplementation((text: string, finishReason: string) =>
        JSON.stringify([
          {
            role: 'assistant',
            parts: [{ type: 'text', content: text }],
            finish_reason: finishReason,
          },
        ])
      );
    (BaseWrapper as any).setBaseSpanAttributes = jest.fn();
  });

  afterEach(() => {
    span.end();
  });

  describe('_parseAudioArgs', () => {
    it('should parse options and speechModel (camelCase) from a params object', () => {
      const parsed = AssemblyAIWrapper._parseAudioArgs([
        {
          audio: 'https://example.com/audio.mp3',
          speechModel: 'nano',
        },
      ]);

      expect(parsed.requestModel).toBe('nano');
      expect(parsed.audioUrl).toBe('https://example.com/audio.mp3');
    });

    it('should parse speech_model (snake_case) and default the model to "best"', () => {
      const withSnake = AssemblyAIWrapper._parseAudioArgs([
        { audio: 'https://example.com/a.mp3', speech_model: 'best' },
      ]);
      expect(withSnake.requestModel).toBe('best');

      const withDefault = AssemblyAIWrapper._parseAudioArgs([
        { audio: 'https://example.com/a.mp3' },
      ]);
      expect(withDefault.requestModel).toBe('best');
    });

    it('should treat a bare string arg as a transcript id (e.g. transcripts.get)', () => {
      const parsed = AssemblyAIWrapper._parseAudioArgs(['transcript-id-123']);
      expect(parsed.audioUrl).toBe('transcript-id-123');
      expect(parsed.requestModel).toBe('best');
    });

    it('should return an empty string (never "undefined"/"null") when audio is missing', () => {
      expect(AssemblyAIWrapper._parseAudioArgs([{ speechModel: 'nano' }]).audioUrl).toBe('');
      expect(AssemblyAIWrapper._parseAudioArgs([{ audio: null }]).audioUrl).toBe('');
      expect(AssemblyAIWrapper._parseAudioArgs([{ audio: undefined }]).audioUrl).toBe('');
      expect(AssemblyAIWrapper._parseAudioArgs([]).audioUrl).toBe('');
    });
  });

  describe('_commonAudioSetter', () => {
    it('should set span attributes from the transcript response and return metric parameters', () => {
      const mockArgs = [
        {
          audio: 'https://example.com/audio.mp3',
          speechModel: 'best',
        },
      ];
      const mockResponse = {
        id: 'transcript-abc',
        text: 'hello transcribed world',
        audio_url: 'https://example.com/audio.mp3',
        audio_duration: 42,
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      (OpenlitConfig as any).captureMessageContent = true;
      jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0.005);

      const metricParams = AssemblyAIWrapper._commonAudioSetter({
        args: mockArgs,
        genAIEndpoint: 'assemblyai.transcripts.transcribe',
        response: mockResponse,
        span,
        isStream: false,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_AUDIO_DURATION,
        42
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        'text'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_ID,
        'transcript-abc'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['stop']
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
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
        0
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_PROVIDER_NAME,
        'assemblyai'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_MODEL,
        'best'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        JSON.stringify([
          { role: 'user', parts: [{ type: 'text', content: 'https://example.com/audio.mp3' }] },
        ])
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        JSON.stringify([
          {
            role: 'assistant',
            parts: [{ type: 'text', content: 'hello transcribed world' }],
            finish_reason: 'stop',
          },
        ])
      );

      expect(metricParams).toEqual({
        genAIEndpoint: 'assemblyai.transcripts.transcribe',
        model: 'best',
        cost: 0.005,
        aiSystem: 'assemblyai',
        serverAddress: 'api.assemblyai.com',
        serverPort: 443,
      });
    });

    it('should stamp the AssemblyAI package version on the span', () => {
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      (OpenlitConfig as any).captureMessageContent = false;
      jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0.005);

      AssemblyAIWrapper._commonAudioSetter({
        args: [{ audio: 'https://example.com/a.mp3' }],
        genAIEndpoint: 'assemblyai.transcripts.transcribe',
        response: { id: 'x', text: '', audio_url: '', audio_duration: 0 },
        span,
        isStream: false,
        sdkVersion: '4.16.1',
      });

      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_SDK_VERSION,
        '4.16.1'
      );
    });

    it('should not set message content if captureMessageContent is false', () => {
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      (OpenlitConfig as any).captureMessageContent = false;
      jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0.005);

      AssemblyAIWrapper._commonAudioSetter({
        args: [{ audio: 'https://example.com/a.mp3' }],
        genAIEndpoint: 'assemblyai.transcripts.transcribe',
        response: { id: 'x', text: 'hi', audio_url: '', audio_duration: 0 },
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

    it('should emit inference event when disableEvents is false and captureMessageContent is true', () => {
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = false;
      (OpenlitConfig as any).captureMessageContent = true;
      jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0.005);

      const spyEmit = jest.spyOn(OpenLitHelper, 'emitInferenceEvent');

      AssemblyAIWrapper._commonAudioSetter({
        args: [{ audio: 'https://example.com/a.mp3', speechModel: 'nano' }],
        genAIEndpoint: 'assemblyai.transcripts.transcribe',
        response: { id: 'rid', text: 'hi', audio_url: '', audio_duration: 5 },
        span,
        isStream: false,
      });

      expect(spyEmit).toHaveBeenCalledWith(
        span,
        expect.objectContaining({
          [SemanticConvention.GEN_AI_OPERATION]: 'audio',
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'nano',
          [SemanticConvention.GEN_AI_RESPONSE_ID]: 'rid',
        })
      );
    });

    it('should not emit inference event when captureMessageContent is false', () => {
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = false;
      (OpenlitConfig as any).captureMessageContent = false;
      jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0.005);

      const spyEmit = jest.spyOn(OpenLitHelper, 'emitInferenceEvent');

      AssemblyAIWrapper._commonAudioSetter({
        args: [{ audio: 'https://example.com/a.mp3', speechModel: 'nano' }],
        genAIEndpoint: 'assemblyai.transcripts.transcribe',
        response: { id: 'rid', text: 'hi', audio_url: '', audio_duration: 5 },
        span,
        isStream: false,
      });

      expect(spyEmit).not.toHaveBeenCalled();
    });

    it('should resolve the model from the transcript response for transcripts.get polls', () => {
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      (OpenlitConfig as any).captureMessageContent = false;
      jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0.005);

      const metricParams = AssemblyAIWrapper._commonAudioSetter({
        args: ['transcript-id-123'],
        genAIEndpoint: 'assemblyai.transcripts.get',
        response: {
          id: 'transcript-id-123',
          text: 'done',
          speech_model: 'nano',
          audio_duration: 10,
        },
        span,
        isStream: false,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_MODEL,
        'nano'
      );
      expect(metricParams.model).toBe('nano');
    });

    it('should pass audio duration to getAudioModelCost when audio_url is absent', () => {
      (OpenlitConfig as any).pricingInfo = { audio: { best: 0.001 } };
      (OpenlitConfig as any).disableEvents = true;
      (OpenlitConfig as any).captureMessageContent = false;
      const costSpy = jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0.01);

      AssemblyAIWrapper._commonAudioSetter({
        args: ['transcript-id-123'],
        genAIEndpoint: 'assemblyai.transcripts.get',
        response: {
          id: 'transcript-id-123',
          text: 'done',
          speech_model: 'best',
          audio_duration: 60,
        },
        span,
        isStream: false,
      });

      expect(costSpy).toHaveBeenCalledWith('best', { audio: { best: 0.001 } }, '', 60);
    });

    it('should never emit the literal string "undefined"/"null" when fields are missing', () => {
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      (OpenlitConfig as any).captureMessageContent = true;
      jest.spyOn(OpenLitHelper, 'getAudioModelCost').mockReturnValue(0);

      // No audio in args, and a response with no id/text/audio_url.
      AssemblyAIWrapper._commonAudioSetter({
        args: [{ speechModel: 'best' }],
        genAIEndpoint: 'assemblyai.transcripts.transcribe',
        response: {},
        span,
        isStream: false,
      });

      const calls = (span.setAttribute as jest.Mock).mock.calls;
      for (const [, value] of calls) {
        expect(value).not.toBe('undefined');
        expect(value).not.toBe('null');
        if (typeof value === 'string') {
          expect(value).not.toContain('"undefined"');
          expect(value).not.toContain('"null"');
        }
      }

      // Response id is set as an empty string rather than 'undefined'.
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_ID,
        ''
      );
      // Input message content is the empty string, not 'undefined'.
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: '' }] }])
      );
    });
  });
});
