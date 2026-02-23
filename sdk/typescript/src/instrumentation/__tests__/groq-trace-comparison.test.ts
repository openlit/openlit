/**
 * Cross-Language Trace Comparison Tests for Groq Integration
 * 
 * These tests verify that TypeScript and Python generate equivalent traces
 * for the same operations.
 */

import GroqWrapper from '../groq/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';
import {
  compareTraces,
  compareMetrics,
  createTraceValidator,
  NormalizedTrace,
} from './trace-comparison-utils';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

describe('Groq Cross-Language Trace Comparison', () => {
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(() => {
    // Create mock span
    mockSpan = {
      setAttribute: jest.fn(),
      addEvent: jest.fn(),
      end: jest.fn(),
      setStatus: jest.fn(),
    };

    // Create mock tracer
    mockTracer = {
      startSpan: jest.fn().mockReturnValue(mockSpan),
    };

    // Mock OpenlitConfig
    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).traceContent = true;
    (OpenlitConfig as any).pricing_json = {};
    (OpenlitConfig as any).updatePricingJson = jest.fn().mockResolvedValue({});

    // Mock OpenLitHelper
    (OpenLitHelper as any).getChatModelCost = jest.fn().mockReturnValue(0.001);
    (OpenLitHelper as any).openaiTokens = jest.fn().mockReturnValue(5);
    (OpenLitHelper as any).handleException = jest.fn();
    (OpenLitHelper as any).createStreamProxy = jest.fn().mockImplementation((stream, generator) => stream);

    // Mock BaseWrapper
    (BaseWrapper as any).recordMetrics = jest.fn();
    (BaseWrapper as any).setBaseSpanAttributes = jest.fn().mockImplementation((span, attrs) => {
      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, attrs.aiSystem);
      span.setAttribute(SemanticConvention.GEN_AI_ENDPOINT, attrs.genAIEndpoint);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, attrs.model);
      if (attrs.cost !== undefined) {
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, attrs.cost);
      }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Chat Completion Trace Consistency', () => {
    it('should set same attributes as Python SDK', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'What is LLM Observability?' }],
          model: 'llama-3.1-8b-instant',
          max_tokens: 100,
          temperature: 0.7,
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test-id-123',
        created: Date.now(),
        model: 'llama-3.1-8b-instant',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'LLM Observability is...' },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };
      
      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      // Verify critical attributes are set (matching Python SDK)
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_PROVIDER_NAME, 'groq');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_ENDPOINT, 'groq.chat.completions');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MODEL, 'llama-3.1-8b-instant');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'llama-3.1-8b-instant');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_ID, 'test-id-123');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 10);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, 30);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
    });

    it('should set streaming attributes matching Python SDK', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test streaming' }],
          model: 'llama-3.1-8b-instant',
          stream: true,
        },
      ];

      // Mock streaming response
      async function* mockStream() {
        yield {
          id: 'test-id',
          created: Date.now(),
          model: 'llama-3.1-8b-instant',
          choices: [{ delta: { content: 'Hello' } }],
        };
        yield {
          id: 'test-id',
          created: Date.now(),
          model: 'llama-3.1-8b-instant',
          choices: [{ delta: { content: ' world' } }],
        };
      }
      
      const generator = GroqWrapper._chatCompletionGenerator({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockStream(),
        span: mockSpan,
      });

      // Consume the stream
      for await (const _ of generator) {
        // Consume chunks
      }

      // Verify streaming-specific attributes are set
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_PROVIDER_NAME, 'groq');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
    });
  });

  describe('Trace Validation', () => {
    it('should set all required attributes matching Python SDK', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama-3.1-8b-instant',
        },
      ];

      const mockResponse = {
        id: 'test',
        model: 'llama-3.1-8b-instant',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };
      
      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      // Verify all required attributes are set (matching Python expectations)
      const setAttributeCalls = (mockSpan.setAttribute as jest.Mock).mock.calls;
      const attributeMap = new Map(setAttributeCalls.map(([key, value]) => [key, value]));

      expect(attributeMap.get(SemanticConvention.GEN_AI_PROVIDER_NAME)).toBe('groq');
      expect(attributeMap.get(SemanticConvention.GEN_AI_OPERATION)).toBe(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
      expect(attributeMap.get(SemanticConvention.GEN_AI_REQUEST_MODEL)).toBe('llama-3.1-8b-instant');
      expect(attributeMap.get(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS)).toBe(5);
      expect(attributeMap.get(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS)).toBe(10);
      expect(attributeMap.get(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS)).toBe(15);
    });
  });
});
