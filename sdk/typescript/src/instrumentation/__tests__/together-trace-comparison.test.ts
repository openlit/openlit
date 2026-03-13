/**
 * Cross-Language Trace Comparison Tests for Together AI Integration
 */

import TogetherWrapper from '../together/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

describe('Together AI Cross-Language Trace Comparison', () => {
  let mockSpan: any;

  beforeEach(() => {
    // Create mock span
    mockSpan = {
      setAttribute: jest.fn(),
      addEvent: jest.fn(),
      end: jest.fn(),
      setStatus: jest.fn(),
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

  describe('Chat Completion Trace Consistency', () => {
    it('should set same attributes as Python SDK', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'What is Together AI?' }],
          model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
          max_tokens: 50,
          temperature: 0.7,
          top_p: 0.9,
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'together-test-id',
        created: Date.now(),
        model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Together AI is...' },
          },
        ],
        usage: {
          prompt_tokens: 9,
          completion_tokens: 12,
          total_tokens: 21,
        },
      };
      
      await TogetherWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'together.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      // Verify critical attributes are set (matching Python SDK)
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_PROVIDER_NAME, 'together');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MODEL, 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 9);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 12);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, 21);
      // Python SDK parity: server.address, server.port, gen_ai.sdk.version
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_ADDRESS, 'api.together.xyz');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 443);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_SDK_VERSION, '1.9.0');
    });
  });
});
