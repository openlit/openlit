/**
 * Cross-Language Trace Comparison Tests for Mistral Integration
 */

import MistralWrapper from '../mistral/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

describe('Mistral Cross-Language Trace Comparison', () => {
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
    (OpenLitHelper as any).getEmbedModelCost = jest.fn().mockReturnValue(0.0001);
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
          messages: [{ role: 'user', content: 'What is Mistral AI?' }],
          model: 'mistral-small-latest',
          max_tokens: 50,
          temperature: 0.7,
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'mistral-test-id',
        created: Date.now(),
        model: 'mistral-small-latest',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Mistral AI is...' },
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 15,
          total_tokens: 23,
        },
      };
      
      await MistralWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'mistral.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      // Verify critical attributes are set (matching Python SDK)
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_PROVIDER_NAME, 'mistral');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MODEL, 'mistral-small-latest');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'mistral-small-latest');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 8);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 15);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, 23);
      // Python SDK parity: server.address, server.port, gen_ai.sdk.version
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_ADDRESS, 'api.mistral.ai');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 443);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_SDK_VERSION, '1.9.0');
    });
  });

  describe('Embedding Trace Consistency', () => {
    it('should set embedding attributes matching Python SDK', async () => {
      const mockArgs = [
        {
          model: 'mistral-embed',
          input: 'Test embedding text',
        },
      ];

      const mockResponse = {
        model: 'mistral-embed',
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: {
          prompt_tokens: 3,
          total_tokens: 3,
        },
      };

      const mockTracer: any = {
        startSpan: jest.fn().mockReturnValue(mockSpan),
      };
      
      const patchMethod = MistralWrapper._patchEmbedding(mockTracer);
      const wrappedMethod = patchMethod(async () => mockResponse);
      
      await wrappedMethod.call({}, ...mockArgs);

      // Verify embedding-specific attributes
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_PROVIDER_NAME, 'mistral');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MODEL, 'mistral-embed');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 3);
    });
  });
});
