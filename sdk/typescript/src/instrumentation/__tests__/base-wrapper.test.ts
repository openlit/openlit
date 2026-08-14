import { Span } from '@opentelemetry/api';
import { defaultResource } from '@opentelemetry/resources';
import SemanticConvention from '../../semantic-convention';
import Metrics from '../../otel/metrics';
import BaseWrapper from '../base-wrapper';
import Openlit from '../../index';

describe('BaseWrapper.setBaseSpanAttributes', () => {
  interface TestSpan extends Partial<Span> {
    attributes?: Record<string, unknown>;
  }
  let span: TestSpan;
  beforeEach(() => {
    Openlit.init({
      applicationName: 'TestApp',
      environment: 'TestEnv',
      otlpEndpoint: 'http://localhost:4318',
    });
    Metrics.resetForTesting();
    Metrics.setup({ resource: defaultResource(), otlpEndpoint: 'http://localhost:4318', environment: 'TestEnv', applicationName: 'TestApp', disableBatch: false, captureMessageContent: true, disableMetrics: false, disableEvents: false } as any);
    jest.spyOn(Metrics.genaiClientUsageTokens!, 'record').mockImplementation(() => {});
    jest.spyOn(Metrics.genaiClientOperationDuration!, 'record').mockImplementation(() => {});
    jest.spyOn(Metrics.genaiCost!, 'record').mockImplementation(() => {});
    span = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      attributes: {
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: 10,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: 20,
        duration: 1.5,
      },
    };
    Object.defineProperty(span, 'setAttributes', {
      value: jest.fn(),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should increment all metrics and set span attributes', () => {
    const baseAttributes = {
      model: 'gpt-4',
      user: 'user1',
      cost: 0.99,
      aiSystem: 'openai',
      genAIEndpoint: 'endpoint',
    };
    // @ts-expect-error: test mock span needs attributes property for metrics extraction
    BaseWrapper.setBaseSpanAttributes(span, baseAttributes);
    BaseWrapper.recordMetrics(span as unknown as Span, baseAttributes);
    
    expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_USER, 'user1');
    expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_COST, 0.99);
    expect(span.setStatus).toHaveBeenCalled();
    expect(Metrics.genaiClientUsageTokens!.record).toHaveBeenCalledWith(10, expect.objectContaining({
      [SemanticConvention.GEN_AI_TOKEN_TYPE]: SemanticConvention.GEN_AI_TOKEN_TYPE_INPUT,
    }));
    expect(Metrics.genaiClientUsageTokens!.record).toHaveBeenCalledWith(20, expect.objectContaining({
      [SemanticConvention.GEN_AI_TOKEN_TYPE]: SemanticConvention.GEN_AI_TOKEN_TYPE_OUTPUT,
    }));
    expect(Metrics.genaiClientOperationDuration!.record).toHaveBeenCalledWith(1.5e-9, expect.any(Object));
    expect(Metrics.genaiCost!.record).toHaveBeenCalledWith(0.99, expect.any(Object));
  });

  it('should handle missing tokens and duration gracefully', () => {
    Object.defineProperty(span, 'attributes', {
      value: {},
      writable: true,
      configurable: true,
      enumerable: true,
    });
    const baseAttributes = {
      genAIEndpoint: 'endpoint',
      model: 'gpt-4',
      user: 'user2',
      cost: undefined,
      aiSystem: 'openai',
    };
    BaseWrapper.setBaseSpanAttributes(span as unknown as Span, baseAttributes);
    BaseWrapper.recordMetrics(span as unknown as Span, baseAttributes);
    
    expect(Metrics.genaiClientUsageTokens!.record).not.toHaveBeenCalled();
    expect(Metrics.genaiClientOperationDuration!.record).not.toHaveBeenCalled();
    expect(Metrics.genaiCost!.record).not.toHaveBeenCalled();
  });

  describe('metrics logic for inputTokens, outputTokens, duration, cost', () => {
    beforeEach(() => {
      Metrics.resetForTesting();
      Metrics.setup({ resource: defaultResource(), otlpEndpoint: 'http://localhost:4318', environment: 'TestEnv', applicationName: 'TestApp', disableBatch: false, captureMessageContent: true, disableMetrics: false, disableEvents: false } as any);
      jest.spyOn(Metrics.genaiClientUsageTokens!, 'record').mockImplementation(() => {});
      jest.spyOn(Metrics.genaiClientOperationDuration!, 'record').mockImplementation(() => {});
      jest.spyOn(Metrics.genaiCost!, 'record').mockImplementation(() => {});
    });

    it('should not call metrics for NaN, undefined, or non-number values', () => {
      const span: TestSpan = {
        setAttribute: jest.fn(),
        setStatus: jest.fn(),
        setAttributes: jest.fn(),
        attributes: {
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: NaN,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: undefined,
          duration: 'not-a-number',
        },
      };
      const baseAttributes = {
        model: 'gpt-4',
        user: 'user1',
        cost: 'not-a-number',
        aiSystem: 'openai',
        genAIEndpoint: 'endpoint',
      };
      BaseWrapper.setBaseSpanAttributes(span as unknown as Span, baseAttributes);
      BaseWrapper.recordMetrics(span as unknown as Span, baseAttributes);
      
      expect(Metrics.genaiClientUsageTokens!.record).not.toHaveBeenCalled();
      expect(Metrics.genaiClientOperationDuration!.record).not.toHaveBeenCalled();
      expect(Metrics.genaiCost!.record).not.toHaveBeenCalled();
    });

    it('should call metrics for zero and negative values', () => {
      const span: TestSpan = {
        setAttribute: jest.fn(),
        setStatus: jest.fn(),
        setAttributes: jest.fn(),
        attributes: {
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: 0,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: -5,
          duration: -1.5,
        },
      };
      const baseAttributes = {
        model: 'gpt-4',
        user: 'user1',
        cost: 0,
        aiSystem: 'openai',
        genAIEndpoint: 'endpoint',
      };
      BaseWrapper.setBaseSpanAttributes(span as unknown as Span, baseAttributes);
      BaseWrapper.recordMetrics(span as unknown as Span, baseAttributes);
      
      expect(Metrics.genaiClientUsageTokens!.record).toHaveBeenCalledWith(0, expect.objectContaining({
        [SemanticConvention.GEN_AI_TOKEN_TYPE]: SemanticConvention.GEN_AI_TOKEN_TYPE_INPUT,
      }));
      expect(Metrics.genaiClientUsageTokens!.record).toHaveBeenCalledWith(-5, expect.objectContaining({
        [SemanticConvention.GEN_AI_TOKEN_TYPE]: SemanticConvention.GEN_AI_TOKEN_TYPE_OUTPUT,
      }));
      expect(Metrics.genaiClientOperationDuration!.record).toHaveBeenCalledWith(-1.5e-9, expect.any(Object));
      expect(Metrics.genaiCost!.record).toHaveBeenCalledWith(0, expect.any(Object));
    });

    it('should convert string cost to number if possible', () => {
      const span: TestSpan = {
        setAttribute: jest.fn(),
        setStatus: jest.fn(),
        setAttributes: jest.fn(),
        attributes: {
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: 1,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: 2,
          duration: 3,
        },
      };
      const baseAttributes = {
        model: 'gpt-4',
        user: 'user1',
        cost: '1.23',
        aiSystem: 'openai',
        genAIEndpoint: 'endpoint',
      };
      BaseWrapper.setBaseSpanAttributes(span as unknown as Span, baseAttributes);
      BaseWrapper.recordMetrics(span as unknown as Span, baseAttributes);
      
      expect(Metrics.genaiCost!.record).toHaveBeenCalledWith(1.23, expect.any(Object));
    });
  });
});
