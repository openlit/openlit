import { Span } from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import SemanticConvention from '../../semantic-convention';
import Metrics from '../../otel/metrics';
import BaseWrapper from '../base-wrapper';

describe('BaseWrapper.setBaseSpanAttributes', () => {
  // Extend Partial<Span> to include 'attributes' for testing
  interface TestSpan extends Partial<Span> {
    attributes?: Record<string, unknown>;
  }
  let span: TestSpan;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let addSpy: jest.SpyInstance;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let recordSpy: jest.SpyInstance;

  beforeEach(() => {
    Metrics.setup({ resource: Resource.default() }); // Ensure metrics are initialized
    addSpy = jest.spyOn(Metrics.genaiRequests!, 'add').mockImplementation(() => {});
    jest.spyOn(Metrics.genaiPromptTokens!, 'add').mockImplementation(() => {});
    jest.spyOn(Metrics.genaiCompletionTokens!, 'add').mockImplementation(() => {});
    jest.spyOn(Metrics.genaiClientOperationDuration!, 'record').mockImplementation(() => {});
    jest.spyOn(Metrics.genaiCost!, 'record').mockImplementation(() => {});
    span = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      // Simulate attributes property for test
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
    // @ts-expect-error: test mock span needs attributes property for metrics extraction
    BaseWrapper.setBaseSpanAttributes(span, {
      model: 'gpt-4',
      user: 'user1',
      cost: 0.99,
      aiSystem: 'openai',
    });
    expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_USER, 'user1');
    expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_COST, 0.99);
    expect(span.setStatus).toHaveBeenCalled();
    expect(Metrics.genaiRequests!.add).toHaveBeenCalledWith(1, expect.objectContaining({
      [SemanticConvention.GEN_AI_SYSTEM]: 'openai',
      [SemanticConvention.GEN_AI_REQUEST_USER]: 'user1',
      [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'gpt-4',
      [SemanticConvention.GEN_AI_USAGE_COST]: 0.99,
    }));
    expect(Metrics.genaiPromptTokens!.add).toHaveBeenCalledWith(10, expect.any(Object));
    expect(Metrics.genaiCompletionTokens!.add).toHaveBeenCalledWith(20, expect.any(Object));
    expect(Metrics.genaiClientOperationDuration!.record).toHaveBeenCalledWith(1.5, expect.any(Object));
    expect(Metrics.genaiCost!.record).toHaveBeenCalledWith(0.99, expect.any(Object));
  });

  it('should handle missing tokens and duration gracefully', () => {
    // Assign attributes property for test mock
    Object.defineProperty(span, 'attributes', {
      value: {},
      writable: true,
      configurable: true,
      enumerable: true,
    });
    BaseWrapper.setBaseSpanAttributes(span as unknown as Span, {
      genAIEndpoint: 'endpoint',
      model: 'gpt-4',
      user: 'user2',
      cost: undefined,
      aiSystem: 'openai',
    });
    expect(Metrics.genaiPromptTokens!.add).not.toHaveBeenCalled();
    expect(Metrics.genaiCompletionTokens!.add).not.toHaveBeenCalled();
    expect(Metrics.genaiClientOperationDuration!.record).not.toHaveBeenCalled();
    expect(Metrics.genaiCost!.record).not.toHaveBeenCalled();
  });
});
