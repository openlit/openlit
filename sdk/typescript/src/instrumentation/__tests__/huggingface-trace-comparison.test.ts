/**
 * Cross-Language Trace Comparison Tests for HuggingFace Inference Integration
 *
 * Verifies that the TypeScript SDK generates traces consistent with the Python SDK
 * for HuggingFace Inference API chatCompletion and textGeneration.
 */

import HuggingFaceWrapper from '../huggingface/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

describe('HuggingFace Cross-Language Trace Comparison', () => {
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      addEvent: jest.fn(),
      end: jest.fn(),
      setStatus: jest.fn(),
    };

    mockTracer = {
      startSpan: jest.fn().mockReturnValue(mockSpan),
    };

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).traceContent = true;
    (OpenlitConfig as any).pricing_json = {};
    (OpenlitConfig as any).updatePricingJson = jest.fn().mockResolvedValue({});

    (OpenLitHelper as any).getChatModelCost = jest.fn().mockReturnValue(0.0005);
    (OpenLitHelper as any).generalTokens = jest.fn().mockReturnValue(8);
    (OpenLitHelper as any).buildInputMessages = jest.fn().mockReturnValue('[]');
    (OpenLitHelper as any).buildOutputMessages = jest.fn().mockReturnValue('[]');
    (OpenLitHelper as any).handleException = jest.fn();
    (OpenLitHelper as any).createStreamProxy = jest.fn().mockImplementation((stream, _gen) => stream);

    (BaseWrapper as any).recordMetrics = jest.fn();
    (BaseWrapper as any).setBaseSpanAttributes = jest.fn().mockImplementation((span: any, attrs: any) => {
      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, attrs.aiSystem);
      span.setAttribute(SemanticConvention.GEN_AI_ENDPOINT, attrs.genAIEndpoint);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, attrs.model);
      if (attrs.cost !== undefined) span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, attrs.cost);
      if (attrs.serverAddress) span.setAttribute(SemanticConvention.SERVER_ADDRESS, attrs.serverAddress);
      if (attrs.serverPort !== undefined) span.setAttribute(SemanticConvention.SERVER_PORT, attrs.serverPort);
      span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, '1.9.0');
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Chat Completion ───────────────────────────────────────────────────────

  describe('Chat Completion', () => {
    const mockArgs = [
      {
        model: 'meta-llama/Meta-Llama-3-8B-Instruct',
        messages: [{ role: 'user', content: 'What is LLM Observability?' }],
        max_tokens: 100,
        temperature: 0.7,
        stream: false,
      },
    ];

    const mockResponse = {
      id: 'hf-chat-123',
      created: Date.now(),
      model: 'meta-llama/Meta-Llama-3-8B-Instruct',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'LLM Observability is...' },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 25, total_tokens: 37 },
    };

    it('should set gen_ai.system = "huggingface" matching Python GEN_AI_SYSTEM_HUGGING_FACE', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_PROVIDER_NAME,
        'huggingface'
      );
    });

    it('should set gen_ai.operation.name = "chat" matching Python', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OPERATION,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT
      );
    });

    it('should set token usage attributes matching Python SDK', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 12);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 25);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, 37);
    });

    it('should set server.address and server.port matching Python', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.SERVER_ADDRESS,
        'api-inference.huggingface.co'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 443);
    });

    it('should set request params: temperature, max_tokens, is_stream', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
    });

    it('should set finish_reason and output_type', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['stop']
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      );
    });

    it('should call recordMetrics after span ends', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.end).toHaveBeenCalled();
      expect(BaseWrapper.recordMetrics).toHaveBeenCalled();
    });
  });

  // ── Streaming ─────────────────────────────────────────────────────────────

  describe('Streaming Chat Completion', () => {
    it('should set is_stream=true and accumulate content across chunks', async () => {
      const mockArgs = [
        {
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        },
      ];

      async function* mockStream() {
        yield {
          id: 'hf-stream-1',
          created: Date.now(),
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          choices: [{ delta: { content: 'Hello' } }],
        };
        yield {
          id: 'hf-stream-1',
          created: Date.now(),
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }],
        };
      }

      const generator = HuggingFaceWrapper._chatCompletionGenerator({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockStream(),
        span: mockSpan,
      });

      for await (const _ of generator) { /* consume */ }

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_PROVIDER_NAME,
        'huggingface'
      );
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  // ── Text Generation ───────────────────────────────────────────────────────

  describe('Text Generation', () => {
    it('should set text_completion operation and correct attributes', async () => {
      const mockArgs = [
        {
          model: 'gpt2',
          inputs: 'The meaning of life is',
          parameters: { max_new_tokens: 50, temperature: 0.9 },
        },
      ];

      const mockResponse = { generated_text: 'The meaning of life is 42.' };

      await HuggingFaceWrapper._textGeneration({
        args: mockArgs,
        genAIEndpoint: 'huggingface.text.generation',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OPERATION,
        SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_PROVIDER_NAME,
        'huggingface'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 50);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.9);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      );
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should capture prompt and completion content when traceContent=true', async () => {
      const mockArgs = [
        {
          model: 'gpt2',
          inputs: 'The meaning of life is',
          parameters: {},
        },
      ];
      const mockResponse = { generated_text: '42.' };

      await HuggingFaceWrapper._textGeneration({
        args: mockArgs,
        genAIEndpoint: 'huggingface.text.generation',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
        'The meaning of life is'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
        '42.'
      );
    });
  });
});
