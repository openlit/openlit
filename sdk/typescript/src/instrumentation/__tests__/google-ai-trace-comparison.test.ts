/**
 * Cross-Language Trace Comparison Tests for Google AI Studio Integration
 */

import GoogleAIWrapper from '../google-ai/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

describe('Google AI Studio Cross-Language Trace Comparison', () => {
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

  describe('Generate Content Trace Consistency', () => {
    it('should set same attributes as Python SDK', async () => {
      const mockArgs = [
        {
          contents: [
            { role: 'user', parts: [{ text: 'What is Gemini?' }] },
          ],
          config: {
            temperature: 0.7,
            maxOutputTokens: 100,
            topP: 0.95,
          },
        },
      ];

      const mockResponse = {
        model: 'gemini-pro',
        candidates: [
          {
            content: {
              parts: [{ text: 'Gemini is Google\'s AI model' }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 10,
          totalTokenCount: 15,
        },
      };
      
      await GoogleAIWrapper._generateContent({
        args: mockArgs,
        genAIEndpoint: 'google.generativeai.models.generate_content',
        response: mockResponse,
        span: mockSpan,
      });

      // Verify critical attributes are set (matching Python SDK)
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_PROVIDER_NAME, 'google_ai_studio');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MODEL, 'gemini-pro');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'gemini-pro');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 5);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 10);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, 15);
    });
  });
});
