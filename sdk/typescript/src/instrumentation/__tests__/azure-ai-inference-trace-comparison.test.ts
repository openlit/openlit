/**
 * Cross-Language Trace Comparison Tests for Azure AI Inference Integration
 */

import { Span, trace } from '@opentelemetry/api';
import AzureAIInferenceWrapper from '../azure-ai-inference/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('Azure AI Inference Cross-Language Trace Comparison', () => {
  let span: Span;

  beforeEach(() => {
    span = mockTracer.startSpan('test-span');
    span.setAttribute = jest.fn();
    span.addEvent = jest.fn();

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = false;
    (OpenlitConfig as any).pricingInfo = {};
    (OpenlitConfig as any).disableEvents = true;

    (OpenLitHelper as any).getChatModelCost = jest.fn().mockReturnValue(0.001);
    (OpenLitHelper as any).handleException = jest.fn();
    (OpenLitHelper as any).buildInputMessages = jest.fn().mockReturnValue('[]');
    (OpenLitHelper as any).buildOutputMessages = jest.fn().mockReturnValue('[]');
    (OpenLitHelper as any).emitInferenceEvent = jest.fn();

    (BaseWrapper as any).recordMetrics = jest.fn();
    (BaseWrapper as any).setBaseSpanAttributes = jest.fn();
  });

  afterEach(() => {
    span.end();
    jest.clearAllMocks();
  });

  function callSetter(usage: any) {
    return AzureAIInferenceWrapper._chatCompletionCommonSetter({
      body: { messages: [{ role: 'user', content: 'Ping' }], model: 'o3-mini' },
      genAIEndpoint: 'azure.ai.inference.chat.completions',
      result: {
        id: 'chatcmpl-1',
        model: 'o3-mini',
        choices: [{ message: { role: 'assistant', content: 'Pong' }, finish_reason: 'stop' }],
        usage,
      },
      span,
      serverAddress: 'test.services.ai.azure.com',
      serverPort: 443,
    });
  }

  describe('reasoning token usage', () => {
    it('reports reasoning tokens from completion_tokens_details (matches Python)', () => {
      callSetter({
        prompt_tokens: 12,
        completion_tokens: 30,
        total_tokens: 42,
        completion_tokens_details: { reasoning_tokens: 18 },
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 30);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS, 18);
    });

    it('falls back to a top-level usage.reasoning_tokens', () => {
      callSetter({
        prompt_tokens: 12,
        completion_tokens: 30,
        total_tokens: 42,
        reasoning_tokens: 7,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS, 7);
    });

    it('does not set the attribute when the provider reports no reasoning tokens', () => {
      callSetter({ prompt_tokens: 12, completion_tokens: 30, total_tokens: 42 });

      expect(span.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS,
        expect.anything()
      );
    });
  });
});
