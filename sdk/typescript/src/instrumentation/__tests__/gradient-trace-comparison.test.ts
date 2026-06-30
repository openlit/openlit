/**
 * Cross-Language Trace Comparison Tests for the DigitalOcean Gradient Integration
 *
 * These verify that the TypeScript Gradient instrumentation emits the same span
 * attributes / events as the Python SDK reference
 * (sdk/python/src/openlit/instrumentation/gradient). Gradient is OpenAI-shaped:
 * responses carry a `model` field, requests support seed / frequency_penalty /
 * presence_penalty, and streaming usage arrives on the final chunk as `usage`.
 * The provider name is `digitalocean` and chat is served from inference.do-ai.run.
 */

import GradientWrapper from '../gradient/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers', () => ({
  __esModule: true,
  default: {},
  isFrameworkLlmActive: jest.fn(() => false),
  getFrameworkParentContext: jest.fn(() => undefined),
  getCurrentAgentVersion: jest.fn(() => undefined),
}));
jest.mock('../base-wrapper');

const SERVER = { serverAddress: 'inference.do-ai.run', serverPort: 443 };
const AGENT_SERVER = { serverAddress: 'abc123.agents.do-ai.run', serverPort: 443 };

describe('Gradient Cross-Language Trace Comparison', () => {
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
    (OpenLitHelper as any).getImageModelCost = jest.fn().mockReturnValue(0.05);
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

  const mockResponse = () => ({
    id: 'gradient-test-id',
    model: 'llama3.3-70b-instruct',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'DO says hi', reasoning_content: 'thinking...' },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });

  describe('Chat Completion Trace Consistency', () => {
    it('should set the same core attributes as the Python SDK', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'What is LLM Observability?' }],
          model: 'llama3.3-70b-instruct',
          max_tokens: 100,
          temperature: 0.7,
          stream: false,
        },
      ];

      await GradientWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.chat.completions',
        response: mockResponse(),
        span: mockSpan,
        ...SERVER,
        operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        apiType: 'chat',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL,
        'digitalocean'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_MODEL,
        'llama3.3-70b-instruct'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_MODEL,
        'llama3.3-70b-instruct'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_ID,
        'gradient-test-id'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 10);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, 30);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OUTPUT_TYPE, 'text');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.OPENAI_API_TYPE, 'chat');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_ADDRESS, 'inference.do-ai.run');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 443);
    });

    it('prefers max_completion_tokens over max_tokens (Python parity)', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama3.3-70b-instruct',
          max_tokens: 50,
          max_completion_tokens: 128,
          stream: false,
        },
      ];

      await GradientWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.chat.completions',
        response: mockResponse(),
        span: mockSpan,
        ...SERVER,
        operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        apiType: 'chat',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 128);
    });

    it('falls back to the "unknown" request model when none is supplied (matches Python)', async () => {
      const mockArgs = [{ messages: [{ role: 'user', content: 'Test' }], stream: false }];
      const responseNoModel = { ...mockResponse(), model: '' };

      await GradientWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.chat.completions',
        response: responseNoModel,
        span: mockSpan,
        ...SERVER,
        operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        apiType: 'chat',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MODEL, 'unknown');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'unknown');
    });

    it('stamps openlit.agent.version_hash on the chat span', async () => {
      const mockArgs = [
        { messages: [{ role: 'user', content: 'Hash me' }], model: 'llama3.3-70b-instruct', stream: false },
      ];

      await GradientWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.chat.completions',
        response: mockResponse(),
        span: mockSpan,
        ...SERVER,
        operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        apiType: 'chat',
      });

      expect((OpenLitHelper as any).computeAgentVersionHash).toHaveBeenCalled();
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.OPENLIT_AGENT_VERSION_HASH,
        'ts-test-version-hash'
      );
    });

    it('should NOT set total_tokens on the span', async () => {
      const mockArgs = [
        { messages: [{ role: 'user', content: 'Test' }], model: 'llama3.3-70b-instruct', stream: false },
      ];

      await GradientWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.chat.completions',
        response: mockResponse(),
        span: mockSpan,
        ...SERVER,
        operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        apiType: 'chat',
      });

      const attributeKeys = (mockSpan.setAttribute as jest.Mock).mock.calls.map(([key]: [string]) => key);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS);
    });

    it('omits seed / penalties / optionals when not provided (no sentinel values)', async () => {
      const mockArgs = [
        { messages: [{ role: 'user', content: 'Test' }], model: 'llama3.3-70b-instruct', stream: false },
      ];

      await GradientWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.chat.completions',
        response: mockResponse(),
        span: mockSpan,
        ...SERVER,
        operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        apiType: 'chat',
      });

      const attributeKeys = (mockSpan.setAttribute as jest.Mock).mock.calls.map(([key]: [string]) => key);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_SEED);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT);
    });

    it('sets seed / penalties when explicitly provided (Gradient is OpenAI-compatible)', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama3.3-70b-instruct',
          seed: 42,
          frequency_penalty: 0.5,
          presence_penalty: 0.3,
          stop: ['END'],
          n: 2,
          reasoning_effort: 'high',
          stream: false,
        },
      ];

      await GradientWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.chat.completions',
        response: mockResponse(),
        span: mockSpan,
        ...SERVER,
        operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        apiType: 'chat',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_SEED, 42);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 0.5);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, 0.3);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, ['END']);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, 2);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_REASONING_EFFORT,
        'high'
      );
    });

    it('does not throw and still records tokens when the response omits usage', async () => {
      const mockArgs = [
        { messages: [{ role: 'user', content: 'Test' }], model: 'llama3.3-70b-instruct', stream: false },
      ];
      const responseNoUsage: any = mockResponse();
      delete responseNoUsage.usage;

      await GradientWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.chat.completions',
        response: responseNoUsage,
        span: mockSpan,
        ...SERVER,
        operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        apiType: 'chat',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 0);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 0);
    });

    it('should emit an inference event via the LoggerProvider', async () => {
      const mockArgs = [
        { messages: [{ role: 'user', content: 'Test' }], model: 'llama3.3-70b-instruct', stream: false },
      ];

      await GradientWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.chat.completions',
        response: mockResponse(),
        span: mockSpan,
        ...SERVER,
        operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        apiType: 'chat',
      });

      expect((OpenLitHelper as any).emitInferenceEvent).toHaveBeenCalled();
    });
  });

  describe('Agent Chat Completion Trace Consistency', () => {
    it('emits invoke_agent operation in inference events (Python parity)', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Run agent' }],
          model: 'agent-model',
          stream: false,
        },
      ];

      await GradientWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.agents.chat.completions',
        response: mockResponse(),
        span: mockSpan,
        ...AGENT_SERVER,
        operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
        apiType: 'chat',
      });

      expect((OpenLitHelper as any).emitInferenceEvent).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
        })
      );
    });
  });

  describe('Image Generation Trace Consistency', () => {
    it('sets image output type and cost like Python process_image_response', async () => {
      const mockArgs = [
        {
          prompt: 'A cute otter',
          model: 'gpt-image-1',
          size: '1024x1024',
          quality: 'high',
        },
      ];
      const response = {
        created: 1710000000,
        model: 'gpt-image-1',
        data: [{ b64_json: 'abc', revised_prompt: 'A very cute otter' }],
      };

      GradientWrapper._imageGenerateCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.images.generate',
        response,
        span: mockSpan,
        ...SERVER,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OUTPUT_TYPE, 'image');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_ID,
        String(1710000000)
      );
      expect((OpenLitHelper as any).getImageModelCost).toHaveBeenCalledWith(
        'gpt-image-1',
        {},
        '1024x1024',
        'high'
      );
    });
  });

  describe('Streaming Trace Consistency', () => {
    async function* mockStream() {
      yield {
        id: 'gradient-stream-id',
        model: 'llama3.3-70b-instruct',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }],
      };
      yield {
        id: 'gradient-stream-id',
        model: 'llama3.3-70b-instruct',
        choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }],
      };
      yield {
        id: 'gradient-stream-id',
        model: 'llama3.3-70b-instruct',
        choices: [],
        usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18 },
      };
    }

    it('aggregates streamed content and reads usage from the final chunk', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Hi' }],
          model: 'llama3.3-70b-instruct',
          stream: true,
        },
      ];

      const generator = GradientWrapper._chatCompletionGenerator({
        args: mockArgs,
        genAIEndpoint: 'digitalocean.chat.completions',
        response: mockStream(),
        span: mockSpan,
        ...SERVER,
        operationName: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        apiType: 'chat',
      });

      let step = await generator.next();
      while (!step.done) {
        step = await generator.next();
      }
      const final: any = step.value;

      expect(final.choices[0].message.content).toBe('Hello world');
      expect(final.choices[0].finish_reason).toBe('stop');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 7);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 11);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);
    });
  });
});
