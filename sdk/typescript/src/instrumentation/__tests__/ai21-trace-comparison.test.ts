/**
 * Cross-Language Trace Comparison Tests for the AI21 Integration
 *
 * These verify that the TypeScript AI21 instrumentation emits the same span
 * attributes / events as the Python SDK reference
 * (sdk/python/src/openlit/instrumentation/ai21). AI21's request surface has no
 * seed / frequency_penalty / presence_penalty, and its responses carry no
 * `model` field, so the response model falls back to the request model.
 */

import AI21Wrapper from '../ai21/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

describe('AI21 Cross-Language Trace Comparison', () => {
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

    (OpenLitHelper as any).getChatModelCost = jest.fn().mockReturnValue(0.001);
    (OpenLitHelper as any).openaiTokens = jest.fn().mockReturnValue(5);
    (OpenLitHelper as any).handleException = jest.fn();
    (OpenLitHelper as any).createStreamProxy = jest
      .fn()
      .mockImplementation((stream, _generator) => stream);
    (OpenLitHelper as any).buildInputMessages = jest
      .fn()
      .mockReturnValue('[{"role":"user","parts":[{"type":"text","content":"Test"}]}]');
    (OpenLitHelper as any).buildOutputMessages = jest
      .fn()
      .mockReturnValue(
        '[{"role":"assistant","parts":[{"type":"text","content":"Response"}],"finish_reason":"stop"}]'
      );
    (OpenLitHelper as any).buildSystemInstructionsFromMessages = jest
      .fn()
      .mockImplementation((messages: any[]) => {
        const sys = (messages || []).find((m: any) => m?.role === 'system');
        return sys ? JSON.stringify([{ type: 'text', content: String(sys.content) }]) : undefined;
      });
    (OpenLitHelper as any).buildToolDefinitions = jest.fn().mockReturnValue(undefined);
    (OpenLitHelper as any).emitInferenceEvent = jest.fn();
    (OpenLitHelper as any).computeAgentVersionHash = jest
      .fn()
      .mockReturnValue('ts-test-version-hash');

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
        span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, '1.9.0');
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // AI21 ChatCompletionResponse shape: no `model`, OpenAI-compatible choices/usage.
  const mockResponse = () => ({
    id: 'ai21-test-id',
    choices: [
      { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Jamba says hi' } },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });

  describe('Chat Completion Trace Consistency', () => {
    it('should set the same core attributes as the Python SDK', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'What is LLM Observability?' }],
          model: 'jamba-large',
          max_tokens: 100,
          temperature: 0.7,
          stream: false,
        },
      ];

      await AI21Wrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'ai21.chat.completions',
        response: mockResponse(),
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, 'ai21');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MODEL, 'jamba-large');
      // AI21 responses carry no `model`, so it falls back to the request model.
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'jamba-large');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_ID, 'ai21-test-id');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 10);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OUTPUT_TYPE, 'text');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_ADDRESS, 'api.ai21.com');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 443);
    });

    it('stamps openlit.agent.version_hash on the chat span', async () => {
      const mockArgs = [
        { messages: [{ role: 'user', content: 'Hash me' }], model: 'jamba-mini', stream: false },
      ];

      await AI21Wrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'ai21.chat.completions',
        response: mockResponse(),
        span: mockSpan,
      });

      expect((OpenLitHelper as any).computeAgentVersionHash).toHaveBeenCalled();
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.OPENLIT_AGENT_VERSION_HASH,
        'ts-test-version-hash'
      );
    });

    it('should NOT set total_tokens or client.token.usage on the span', async () => {
      const mockArgs = [
        { messages: [{ role: 'user', content: 'Test' }], model: 'jamba-mini', stream: false },
      ];

      await AI21Wrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'ai21.chat.completions',
        response: mockResponse(),
        span: mockSpan,
      });

      const attributeKeys = (mockSpan.setAttribute as jest.Mock).mock.calls.map(([key]: [string]) => key);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE);
    });

    it('should never emit seed / penalty attrs and omits unset optionals', async () => {
      const mockArgs = [
        { messages: [{ role: 'user', content: 'Test' }], model: 'jamba-mini', stream: false },
      ];

      await AI21Wrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'ai21.chat.completions',
        response: mockResponse(),
        span: mockSpan,
      });

      const attributeKeys = (mockSpan.setAttribute as jest.Mock).mock.calls.map(([key]: [string]) => key);
      // AI21 has no seed / frequency_penalty / presence_penalty.
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_SEED);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY);
      // Optionals not supplied in this request.
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT);
    });

    it('should set max_tokens, stop and choice_count only when explicitly provided', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'jamba-mini',
          max_tokens: 200,
          stop: ['END'],
          n: 2,
          stream: false,
        },
      ];

      await AI21Wrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'ai21.chat.completions',
        response: mockResponse(),
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 200);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, ['END']);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, 2);
    });

    it('should emit an inference event via the LoggerProvider', async () => {
      const mockArgs = [
        { messages: [{ role: 'user', content: 'Test' }], model: 'jamba-mini', stream: false },
      ];

      await AI21Wrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'ai21.chat.completions',
        response: mockResponse(),
        span: mockSpan,
      });

      expect((OpenLitHelper as any).emitInferenceEvent).toHaveBeenCalled();
    });
  });
});
