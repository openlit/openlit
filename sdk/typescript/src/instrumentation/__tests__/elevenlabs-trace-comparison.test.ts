/**
 * Cross-Language Trace Comparison Tests for the ElevenLabs Integration
 *
 * Verifies that the TypeScript ElevenLabs instrumentation emits TTS telemetry
 * aligned with the Python SDK reference in sdk/python/src/openlit/instrumentation/elevenlabs.
 */

import ElevenLabsWrapper from '../elevenlabs/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers', () => ({
  __esModule: true,
  default: {
    getAudioModelCost: jest.fn(),
    handleException: jest.fn(),
    buildInputMessages: jest.fn(),
    buildOutputMessages: jest.fn(),
    emitInferenceEvent: jest.fn(),
  },
  isFrameworkLlmActive: jest.fn(() => false),
  getFrameworkParentContext: jest.fn(() => undefined),
}));
jest.mock('../base-wrapper');

describe('ElevenLabs Cross-Language Trace Comparison', () => {
  let mockSpan: any;

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      addEvent: jest.fn(),
      end: jest.fn(),
      setStatus: jest.fn(),
    };

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
    (OpenlitConfig as any).pricingInfo = {};
    (OpenlitConfig as any).disableEvents = false;

    (OpenLitHelper as any).getAudioModelCost = jest.fn().mockReturnValue(0.012);
    (OpenLitHelper as any).handleException = jest.fn();
    (OpenLitHelper as any).buildInputMessages = jest
      .fn()
      .mockReturnValue('[{"role":"user","parts":[{"type":"text","content":"Hello from OpenLIT"}]}]');
    (OpenLitHelper as any).buildOutputMessages = jest
      .fn()
      .mockReturnValue(
        '[{"role":"assistant","parts":[{"type":"text","content":"[audio generated]"}],"finish_reason":"stop"}]'
      );
    (OpenLitHelper as any).emitInferenceEvent = jest.fn();

    (BaseWrapper as any).recordMetrics = jest.fn();
    (BaseWrapper as any).setBaseSpanAttributes = jest
      .fn()
      .mockImplementation((span, attrs) => {
        span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, attrs.aiSystem);
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, attrs.model);
        if (attrs.cost !== undefined) {
          span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, attrs.cost);
        }
        if (attrs.serverAddress) {
          span.setAttribute(SemanticConvention.SERVER_ADDRESS, attrs.serverAddress);
        }
        if (attrs.serverPort !== undefined) {
          span.setAttribute(SemanticConvention.SERVER_PORT, attrs.serverPort);
        }
        span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, '1.13.0');
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const ttsArgs = [
    'voice-123',
    {
      text: 'Hello from OpenLIT',
      modelId: 'eleven_turbo_v2',
      outputFormat: 'mp3_44100_128',
      voiceSettings: { stability: 0.5, similarity_boost: 0.8 },
    },
  ];

  it('sets core TTS span attributes aligned with Python ElevenLabs instrumentation', async () => {
    await ElevenLabsWrapper._textToSpeech({
      args: ttsArgs,
      genAIEndpoint: 'elevenlabs.text_to_speech',
      methodName: 'convert',
      response: {},
      span: mockSpan,
    });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL,
      'elevenlabs'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_OPERATION,
      SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_REQUEST_MODEL,
      'eleven_turbo_v2'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_RESPONSE_MODEL,
      'eleven_turbo_v2'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
      false
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE,
      'voice-123'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT,
      'mp3_44100_128'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_OUTPUT_TYPE,
      SemanticConvention.GEN_AI_OUTPUT_TYPE_SPEECH
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.SERVER_ADDRESS,
      'api.elevenlabs.io'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.SERVER_PORT,
      443
    );
  });

  it('supports the snake_case request shape used by elevenlabs v1', async () => {
    await ElevenLabsWrapper._textToSpeech({
      args: [
        'voice-v1',
        {
          text: 'Legacy request shape',
          model_id: 'eleven_multilingual_v1',
          output_format: 'pcm_16000',
          voice_settings: { style: 0.2 },
        },
      ],
      genAIEndpoint: 'elevenlabs.text_to_speech',
      methodName: 'convert',
      response: {},
      span: mockSpan,
    });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_REQUEST_MODEL,
      'eleven_multilingual_v1'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT,
      'pcm_16000'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_REQUEST_AUDIO_SETTINGS,
      JSON.stringify({ style: 0.2 })
    );
  });

  it('marks stream methods as streaming requests', async () => {
    await ElevenLabsWrapper._textToSpeech({
      args: ttsArgs,
      genAIEndpoint: 'elevenlabs.text_to_speech',
      methodName: 'stream',
      response: {},
      span: mockSpan,
    });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
      true
    );
  });

  it('captures input and output messages when captureMessageContent=true', async () => {
    (OpenlitConfig as any).captureMessageContent = true;

    await ElevenLabsWrapper._textToSpeech({
      args: ttsArgs,
      genAIEndpoint: 'elevenlabs.text_to_speech',
      methodName: 'convert',
      response: {},
      span: mockSpan,
    });

    expect(OpenLitHelper.buildInputMessages).toHaveBeenCalledWith([
      { role: 'user', content: 'Hello from OpenLIT' },
    ]);
    expect(OpenLitHelper.buildOutputMessages).toHaveBeenCalledWith('[audio generated]', 'stop');
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_INPUT_MESSAGES,
      expect.any(String)
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
      expect.any(String)
    );
  });

  it('emits events without message content when captureMessageContent=false', async () => {
    (OpenlitConfig as any).captureMessageContent = false;

    await ElevenLabsWrapper._textToSpeech({
      args: ttsArgs,
      genAIEndpoint: 'elevenlabs.text_to_speech',
      methodName: 'convert',
      response: {},
      span: mockSpan,
    });

    const eventAttrs = (OpenLitHelper.emitInferenceEvent as jest.Mock).mock.calls[0][1];
    expect(eventAttrs[SemanticConvention.GEN_AI_OPERATION]).toBe(
      SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO
    );
    expect(eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES]).toBeUndefined();
    expect(eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]).toBeUndefined();

    const attributeKeys = (mockSpan.setAttribute as jest.Mock).mock.calls.map(
      ([key]: [string]) => key
    );
    expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_INPUT_MESSAGES);
    expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_OUTPUT_MESSAGES);
  });

  it('uses audio pricing and records metrics with ElevenLabs endpoint metadata', async () => {
    await ElevenLabsWrapper._textToSpeech({
      args: ttsArgs,
      genAIEndpoint: 'elevenlabs.text_to_speech',
      methodName: 'convert',
      response: {},
      span: mockSpan,
    });

    expect(OpenLitHelper.getAudioModelCost).toHaveBeenCalledWith(
      'eleven_turbo_v2',
      {},
      'Hello from OpenLIT'
    );
    expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(
      mockSpan,
      expect.objectContaining({
        genAIEndpoint: 'elevenlabs.text_to_speech',
        model: 'eleven_turbo_v2',
        cost: 0.012,
        aiSystem: 'elevenlabs',
        serverAddress: 'api.elevenlabs.io',
        serverPort: 443,
      })
    );
  });

  it('handles deprecated ElevenLabsClient.generate request shape', async () => {
    await ElevenLabsWrapper._textToSpeech({
      args: [
        {
          voice: 'Sarah',
          text: 'Generate request',
          model_id: 'eleven_multilingual_v2',
          stream: true,
        },
      ],
      genAIEndpoint: 'elevenlabs.text_to_speech',
      methodName: 'generate',
      response: {},
      span: mockSpan,
    });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE,
      'Sarah'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
      true
    );
  });
});
