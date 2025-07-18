import Metrics from '../metrics';
import SemanticConvention from '../../semantic-convention';
import { Resource } from '@opentelemetry/resources';

describe('Metrics creation', () => {
  beforeEach(() => {
    Metrics.setup({ resource: Resource.default() }); // Ensure metrics are initialized
  });

  it('should create genaiRequests counter and allow increment', () => {
    expect(Metrics.genaiRequests).toBeDefined();
    expect(typeof Metrics.genaiRequests.add).toBe('function');
    expect(() => Metrics.genaiRequests.add(1, { [SemanticConvention.GEN_AI_SYSTEM]: 'openai' })).not.toThrow();
  });

  it('should create genaiPromptTokens counter and allow increment', () => {
    expect(Metrics.genaiPromptTokens).toBeDefined();
    expect(typeof Metrics.genaiPromptTokens.add).toBe('function');
    expect(() => Metrics.genaiPromptTokens.add(42, { [SemanticConvention.GEN_AI_SYSTEM]: 'openai' })).not.toThrow();
  });

  it('should create genaiCompletionTokens counter and allow increment', () => {
    expect(Metrics.genaiCompletionTokens).toBeDefined();
    expect(typeof Metrics.genaiCompletionTokens.add).toBe('function');
    expect(() => Metrics.genaiCompletionTokens.add(24, { [SemanticConvention.GEN_AI_SYSTEM]: 'openai' })).not.toThrow();
  });

  it('should create genaiClientOperationDuration histogram and allow record', () => {
    expect(Metrics.genaiClientOperationDuration).toBeDefined();
    expect(typeof Metrics.genaiClientOperationDuration.record).toBe('function');
    expect(() => Metrics.genaiClientOperationDuration.record(1.23, { [SemanticConvention.GEN_AI_SYSTEM]: 'openai' })).not.toThrow();
  });

  it('should create genaiCost histogram and allow record', () => {
    expect(Metrics.genaiCost).toBeDefined();
    expect(typeof Metrics.genaiCost.record).toBe('function');
    expect(() => Metrics.genaiCost.record(0.99, { [SemanticConvention.GEN_AI_SYSTEM]: 'openai' })).not.toThrow();
  });
});
