import Metrics from '../metrics';
import SemanticConvention from '../../semantic-convention';
import { defaultResource } from '@opentelemetry/resources';

const setupOpts = {
  resource: defaultResource(),
  otlpEndpoint: 'http://localhost:4318',
  environment: 'default',
  applicationName: 'default',
  disableBatch: false,
  captureMessageContent: true,
  disableMetrics: false,
  disableEvents: false,
};

describe('Metrics creation', () => {
  beforeEach(() => {
    Metrics.resetForTesting();
    Metrics.setup(setupOpts as any);
  });

  it('should create genaiClientUsageTokens histogram and allow record', () => {
    expect(Metrics.genaiClientUsageTokens).toBeDefined();
    expect(typeof Metrics.genaiClientUsageTokens.record).toBe('function');
    expect(() => Metrics.genaiClientUsageTokens.record(42, { [SemanticConvention.GEN_AI_PROVIDER_NAME]: 'openai' })).not.toThrow();
  });

  it('should create genaiClientOperationDuration histogram and allow record', () => {
    expect(Metrics.genaiClientOperationDuration).toBeDefined();
    expect(typeof Metrics.genaiClientOperationDuration.record).toBe('function');
    expect(() => Metrics.genaiClientOperationDuration.record(1.23, { [SemanticConvention.GEN_AI_PROVIDER_NAME]: 'openai' })).not.toThrow();
  });

  it('should create genaiCost histogram and allow record', () => {
    expect(Metrics.genaiCost).toBeDefined();
    expect(typeof Metrics.genaiCost.record).toBe('function');
    expect(() => Metrics.genaiCost.record(0.99, { [SemanticConvention.GEN_AI_PROVIDER_NAME]: 'openai' })).not.toThrow();
  });
});
