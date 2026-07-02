import { Span, trace } from '@opentelemetry/api';
import VllmWrapper from '../vllm/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('VllmWrapper', () => {
  let span: Span;

  beforeEach(() => {
    span = mockTracer.startSpan('test-span');
    span.setAttribute = jest.fn();
    span.addEvent = jest.fn();
    jest.clearAllMocks();
    jest.restoreAllMocks();
    VllmWrapper.baseUrlPrefixes = [...VllmWrapper.defaultBaseUrlPrefixes];
  });

  afterEach(() => {
    span.end();
  });

  describe('isVllmClient / extractServerInfo', () => {
    it('returns false for default OpenAI client (api.openai.com)', () => {
      expect(VllmWrapper.isVllmClient({ baseURL: 'https://api.openai.com/v1' })).toBe(false);
    });

    it('returns true for localhost:8000 vLLM endpoint', () => {
      expect(VllmWrapper.isVllmClient({ baseURL: 'http://127.0.0.1:8000/v1' })).toBe(true);
    });

    it('returns true for custom baseUrlPrefixes', () => {
      VllmWrapper.baseUrlPrefixes.push('http://gpu-cluster:8080/v1');
      expect(VllmWrapper.isVllmClient({ baseURL: 'http://gpu-cluster:8080/v1' })).toBe(true);
    });

    it('extracts server address and port from client baseURL', () => {
      const info = VllmWrapper.extractServerInfo({ baseURL: 'http://my-vllm:9000/v1' });
      expect(info).toEqual({ address: 'my-vllm', port: 9000 });
    });
  });

  describe('_patchChat routing', () => {
    it('delegates non-vLLM clients to the OpenAI handler', async () => {
      const openaiHandler = jest.fn().mockResolvedValue({ id: 'openai-resp' });
      const rawCreate = jest.fn();
      const patchFn = VllmWrapper._patchChat(mockTracer, openaiHandler, rawCreate);
      const wrapped = patchFn(jest.fn());

      const client = { baseURL: 'https://api.openai.com/v1' };
      const result = await wrapped.call(client, { model: 'gpt-4o', messages: [] });

      expect(openaiHandler).toHaveBeenCalled();
      expect(rawCreate).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'openai-resp' });
    });

    it('creates a vLLM span for vLLM clients', async () => {
      const openaiHandler = jest.fn();
      const rawCreate = jest.fn().mockResolvedValue({
        id: 'vllm-resp',
        model: 'facebook/opt-125m',
        choices: [{ message: { content: 'hi', role: 'assistant' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
      const patchFn = VllmWrapper._patchChat(mockTracer, openaiHandler, rawCreate);
      const wrapped = patchFn(jest.fn());

      jest.spyOn(mockTracer, 'startSpan').mockReturnValue(span);
      jest.spyOn(VllmWrapper, '_chat').mockResolvedValue({ id: 'vllm-resp' });

      const client = { baseURL: 'http://127.0.0.1:8000/v1' };
      await wrapped.call(client, { model: 'facebook/opt-125m', messages: [{ role: 'user', content: 'hi' }] });

      expect(openaiHandler).not.toHaveBeenCalled();
      expect(rawCreate).toHaveBeenCalled();
      expect(mockTracer.startSpan).toHaveBeenCalled();
      expect(VllmWrapper._chat).toHaveBeenCalled();
    });
  });

  describe('_chat', () => {
    it('should call recordMetrics after span ends', async () => {
      const mockArgs = [{ messages: [{ role: 'user', content: 'test message' }] }];
      const mockResponse = {
        id: 'chatcmpl-123',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        choices: [
          {
            message: { content: 'response text', role: 'assistant' },
            finish_reason: 'stop',
          },
        ],
      };
      const mockGenAIEndpoint = 'vllm.chat';

      jest
        .spyOn(VllmWrapper, '_chatCommonSetter')
        .mockImplementationOnce(async ({ genAIEndpoint, span }) => {
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, 1);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);

          return {
            genAIEndpoint,
            model: 'facebook/opt-125m',
            cost: 0.0,
            aiSystem: SemanticConvention.GEN_AI_SYSTEM_VLLM,
            serverAddress: '127.0.0.1',
            serverPort: 8000,
          };
        });

      await VllmWrapper._chat({
        args: mockArgs,
        genAIEndpoint: mockGenAIEndpoint,
        response: mockResponse,
        span,
        serverAddress: '127.0.0.1',
        serverPort: 8000,
      });

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(span, {
        genAIEndpoint: mockGenAIEndpoint,
        model: 'facebook/opt-125m',
        cost: 0.0,
        aiSystem: SemanticConvention.GEN_AI_SYSTEM_VLLM,
        serverAddress: '127.0.0.1',
        serverPort: 8000,
      });
    });
  });

  describe('_chatGenerator streaming', () => {
    async function* mockStream() {
      yield {
        id: 'chatcmpl-stream',
        model: 'facebook/opt-125m',
        choices: [{
          delta: { role: 'assistant', content: 'Hello' },
          finish_reason: null,
        }],
      };
      yield {
        id: 'chatcmpl-stream',
        model: 'facebook/opt-125m',
        choices: [{
          delta: {
            tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"loc' } }],
          },
          finish_reason: null,
        }],
      };
      yield {
        id: 'chatcmpl-stream',
        model: 'facebook/opt-125m',
        choices: [{
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '":"SF"}' } }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 5, completion_tokens: 10 },
      };
    }

    it('aggregates streaming tool_calls across chunks', async () => {
      jest.restoreAllMocks();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      const generator = VllmWrapper._chatGenerator({
        args: [{ model: 'facebook/opt-125m', messages: [{ role: 'user', content: 'weather?' }], stream: true }],
        genAIEndpoint: 'vllm.chat',
        response: mockStream(),
        span,
        serverAddress: '127.0.0.1',
        serverPort: 8000,
      });

      // drain generator
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of generator) { /* consume */ }

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_TOOL_NAME, 'get_weather');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_TOOL_CALL_ID, 'call_1');
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_ARGS,
        '{"loc":"SF"}'
      );
    });
  });

  describe('_chatCommonSetter', () => {
    it('should set span attributes and return metric parameters', async () => {
      const mockArgs = [
        {
          model: 'facebook/opt-125m',
          messages: [{ role: 'user', content: 'test message' }],
          max_tokens: 100,
          temperature: 0.7,
          top_p: 1,
          top_k: 40,
          presence_penalty: 2,
          frequency_penalty: 3,
          seed: 3,
          stream: false,
          stop: ['STOP'],
        },
      ];

      const mockResult = {
        id: 'chatcmpl-123',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        choices: [
          {
            message: { content: 'response text', role: 'assistant' },
            finish_reason: 'stop',
          },
        ],
      };

      jest.restoreAllMocks();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.0);

      const metricParams = await VllmWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        result: mockResult,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_P, 1);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_K, 40);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, 2);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 3);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_SEED, 3);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, ['STOP']);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'facebook/opt-125m');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 10);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, 30);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);

      expect(metricParams).toEqual({
        genAIEndpoint: 'vllm.chat',
        model: 'facebook/opt-125m',
        cost: 0.0,
        aiSystem: SemanticConvention.GEN_AI_SYSTEM_VLLM,
        serverAddress: '127.0.0.1',
        serverPort: 8000,
      });
    });

    it('should record zero penalty values', async () => {
      const mockArgs = [
        {
          model: 'facebook/opt-125m',
          messages: [{ role: 'user', content: 'test' }],
          presence_penalty: 0,
          frequency_penalty: 0,
          stream: false,
        },
      ];

      const mockResult = {
        id: 'chatcmpl-zero',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        choices: [{ message: { content: 'ok', role: 'assistant' }, finish_reason: 'stop' }],
      };

      jest.restoreAllMocks();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      await VllmWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        result: mockResult,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, 0);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 0);
    });

    it('should NOT set sentinel values for optional request params', async () => {
      const mockArgs = [
        {
          model: 'facebook/opt-125m',
          messages: [{ role: 'user', content: 'test' }],
          stream: false,
        },
      ];

      const mockResult = {
        id: 'chatcmpl-456',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 5, completion_tokens: 10 },
        choices: [
          {
            message: { content: 'test response', role: 'assistant' },
            finish_reason: 'stop',
          },
        ],
      };

      jest.restoreAllMocks();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      await VllmWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        result: mockResult,
        span,
      });

      const setAttrCalls = (span.setAttribute as jest.Mock).mock.calls;
      const attrKeys = setAttrCalls.map((c: any[]) => c[0]);

      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_SEED);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT);
    });

    it('should set gen_ai.input.messages on span when capture enabled', async () => {
      const mockArgs = [
        {
          model: 'facebook/opt-125m',
          messages: [{ role: 'user', content: 'hello' }],
          stream: false,
        },
      ];

      const mockResult = {
        id: 'chatcmpl-input',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 2, completion_tokens: 3 },
        choices: [{ message: { content: 'hi', role: 'assistant' }, finish_reason: 'stop' }],
      };

      jest.restoreAllMocks();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      (OpenlitConfig as any).captureMessageContent = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      jest.spyOn(OpenLitHelper, 'buildInputMessages').mockReturnValue('[{"role":"user","content":"hello"}]');
      jest.spyOn(OpenLitHelper, 'buildOutputMessages').mockReturnValue('[]');

      await VllmWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        result: mockResult,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        '[{"role":"user","content":"hello"}]'
      );
    });

    it('should handle tool calls properly', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'test message' }],
          tools: [{ type: 'function', function: { name: 'get_weather' } }],
        },
      ];

      const mockResult = {
        id: 'chatcmpl-123',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        choices: [
          {
            message: {
              content: null,
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"location":"SF"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.0);

      await VllmWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        result: mockResult,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_TOOL_NAME, 'get_weather');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_TOOL_CALL_ID, 'call_123');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_TOOL_ARGS, '{"location":"SF"}');
    });

    it('should emit inference event when events not disabled', async () => {
      const mockArgs = [
        {
          model: 'facebook/opt-125m',
          messages: [{ role: 'user', content: 'test message' }],
          stream: false,
        },
      ];

      const mockResult = {
        id: 'chatcmpl-789',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        choices: [
          {
            message: { content: 'response text', role: 'assistant' },
            finish_reason: 'stop',
          },
        ],
      };

      jest.restoreAllMocks();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = false;
      (OpenlitConfig as any).disableEvents = false;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      jest.spyOn(OpenLitHelper, 'emitInferenceEvent').mockImplementation(() => {});

      await VllmWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        result: mockResult,
        span,
        serverAddress: 'my-vllm',
        serverPort: 9000,
      });

      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalledWith(
        span,
        expect.objectContaining({
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'facebook/opt-125m',
          [SemanticConvention.GEN_AI_RESPONSE_MODEL]: 'facebook/opt-125m',
          [SemanticConvention.SERVER_ADDRESS]: 'my-vllm',
          [SemanticConvention.SERVER_PORT]: 9000,
          [SemanticConvention.GEN_AI_RESPONSE_ID]: 'chatcmpl-789',
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: 10,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: 20,
        })
      );
    });

    it('falls back to token estimation when usage is missing', async () => {
      jest.restoreAllMocks();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      jest.spyOn(OpenLitHelper, 'openaiTokens').mockReturnValue(7);

      await VllmWrapper._chatCommonSetter({
        args: [{ model: 'facebook/opt-125m', messages: [{ role: 'user', content: 'hi' }] }],
        genAIEndpoint: 'vllm.chat',
        result: {
          id: 'no-usage',
          model: 'facebook/opt-125m',
          choices: [{ message: { content: 'hello', role: 'assistant' }, finish_reason: 'stop' }],
        },
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 7);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 7);
    });
  });

  describe('Cross-Language Trace Comparison', () => {
    it('should use vllm as provider name (matching Python SDK)', () => {
      expect(VllmWrapper.aiSystem).toBe('vllm');
      expect(VllmWrapper.aiSystem).toBe(SemanticConvention.GEN_AI_SYSTEM_VLLM);
    });

    it('should use port 8000 as default (matching vLLM default server port)', () => {
      expect(VllmWrapper.serverPort).toBe(8000);
    });

    it('should set same attributes as Python SDK for chat completion', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'What is vLLM?' }],
          model: 'facebook/opt-125m',
          max_tokens: 50,
          temperature: 0.7,
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'chatcmpl-test-id',
        model: 'facebook/opt-125m',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'vLLM is...' },
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 15,
        },
      };

      jest.restoreAllMocks();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = true;
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.0);
      jest.spyOn(OpenLitHelper, 'buildInputMessages').mockReturnValue('[]');
      jest.spyOn(OpenLitHelper, 'buildOutputMessages').mockReturnValue('[]');

      await VllmWrapper._chat({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        response: mockResponse,
        span,
        serverAddress: '127.0.0.1',
        serverPort: 8000,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 8);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 15);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'facebook/opt-125m');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 50);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_INPUT_MESSAGES, '[]');

      const setAttrCalls = (span.setAttribute as jest.Mock).mock.calls;
      const attrKeys = setAttrCalls.map((c: any[]) => c[0]);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS);
    });
  });
});

describe('OpenlitVllmInstrumentation patch targets', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const VllmInstrumentation = require('../vllm').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isWrapped } = require('@opentelemetry/instrumentation');

  it('wraps OpenAI.Chat.Completions.prototype.create once with vLLM routing', () => {
    const rawCreate = jest.fn();
    const fakeOpenAiModule = {
      OpenAI: function () {},
    } as any;
    fakeOpenAiModule.OpenAI.Chat = { Completions: function () {} };
    fakeOpenAiModule.OpenAI.Chat.Completions.prototype.create = rawCreate;

    const instr = new VllmInstrumentation();
    instr.manualPatch(fakeOpenAiModule);

    expect(isWrapped(fakeOpenAiModule.OpenAI.Chat.Completions.prototype.create)).toBe(true);
    expect(fakeOpenAiModule.OpenAI.Chat.Completions.prototype.create).not.toBe(rawCreate);
  });
});
