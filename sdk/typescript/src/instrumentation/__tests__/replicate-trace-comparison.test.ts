/**
 * Trace Comparison Tests for Replicate Integration
 *
 * Verifies that the TypeScript SDK generates consistent traces for
 * Replicate model runs.
 */

import ReplicateWrapper from '../replicate/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

describe('Replicate Trace Comparison', () => {
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
    (OpenlitConfig as any).traceContent = true;
    (OpenlitConfig as any).pricing_json = {};
    (OpenlitConfig as any).updatePricingJson = jest.fn().mockResolvedValue({});

    (OpenLitHelper as any).getChatModelCost = jest.fn().mockReturnValue(0.001);
    (OpenLitHelper as any).generalTokens = jest.fn().mockReturnValue(10);
    (OpenLitHelper as any).handleException = jest.fn();

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

  describe('run() — text output', () => {
    const identifier = 'meta/llama-2-70b-chat';
    const mockArgs = [
      identifier,
      { input: { prompt: 'What is the capital of France?' } },
    ];

    it('should set gen_ai.system = "replicate"', async () => {
      await ReplicateWrapper._run({
        args: mockArgs,
        genAIEndpoint: 'replicate.run',
        response: 'Paris.',
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_PROVIDER_NAME,
        'replicate'
      );
    });

    it('should set gen_ai.request.model stripped of version hash', async () => {
      await ReplicateWrapper._run({
        args: mockArgs,
        genAIEndpoint: 'replicate.run',
        response: 'Paris.',
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_MODEL,
        'meta/llama-2-70b-chat'
      );
    });

    it('should strip version hash from identifier with colon', async () => {
      const argsWithVersion = [
        'stability-ai/sdxl:abc123def456',
        { input: { prompt: 'A sunset over mountains' } },
      ];

      await ReplicateWrapper._run({
        args: argsWithVersion,
        genAIEndpoint: 'replicate.run',
        response: ['https://example.com/image.png'],
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_MODEL,
        'stability-ai/sdxl'
      );
    });

    it('should set text_completion operation', async () => {
      await ReplicateWrapper._run({
        args: mockArgs,
        genAIEndpoint: 'replicate.run',
        response: 'Paris.',
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OPERATION,
        SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION
      );
    });

    it('should set output_type=text for string responses', async () => {
      await ReplicateWrapper._run({
        args: mockArgs,
        genAIEndpoint: 'replicate.run',
        response: 'Paris.',
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      );
    });

    it('should set output_type=text for array responses (streaming text chunks)', async () => {
      await ReplicateWrapper._run({
        args: mockArgs,
        genAIEndpoint: 'replicate.run',
        response: ['Par', 'is', '.'],
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      );
    });

    it('should set output_type=json for object responses', async () => {
      await ReplicateWrapper._run({
        args: mockArgs,
        genAIEndpoint: 'replicate.run',
        response: { answer: 'Paris', confidence: 0.99 },
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON
      );
    });

    it('should set server.address = api.replicate.com and port 443', async () => {
      await ReplicateWrapper._run({
        args: mockArgs,
        genAIEndpoint: 'replicate.run',
        response: 'Paris.',
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.SERVER_ADDRESS,
        'api.replicate.com'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 443);
    });

    it('should capture prompt content when traceContent=true', async () => {
      await ReplicateWrapper._run({
        args: mockArgs,
        genAIEndpoint: 'replicate.run',
        response: 'Paris.',
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
        'What is the capital of France?'
      );
    });

    it('should end span and record metrics', async () => {
      await ReplicateWrapper._run({
        args: mockArgs,
        genAIEndpoint: 'replicate.run',
        response: 'Paris.',
        span: mockSpan,
      });

      expect(mockSpan.end).toHaveBeenCalled();
      expect(BaseWrapper.recordMetrics).toHaveBeenCalled();
    });
  });
});
