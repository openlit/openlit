// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

describe('metrics', () => {
  let spy;
  beforeEach(() => {
    jest.resetModules();
    spy = jest.fn();
    // Patch getMeter at runtime
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const otelApi = require('@opentelemetry/api');
    otelApi.metrics.getMeter = () => ({ createCounter: () => ({ add: spy }) });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const metricsMod = require('../metrics');
    metricsMod.evalCounter = undefined;
  });

  it('recordEvalMetrics calls counter.add with correct attributes', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { recordEvalMetrics, EVAL_METRIC_ATTRIBUTES } = require('../metrics');
    const result = {
      verdict: 'yes',
      evaluation: 'bias_detection',
      score: 0.8,
      classification: 'age',
      explanation: 'reason',
    };
    const validator = 'openai';
    recordEvalMetrics(result, validator);
    expect(spy).toHaveBeenCalledWith(1, expect.objectContaining({
      [EVAL_METRIC_ATTRIBUTES.verdict]: 'yes',
      [EVAL_METRIC_ATTRIBUTES.score]: 0.8,
      [EVAL_METRIC_ATTRIBUTES.validator]: 'openai',
      [EVAL_METRIC_ATTRIBUTES.classification]: 'age',
      [EVAL_METRIC_ATTRIBUTES.explanation]: 'reason',
      evaluation: 'bias_detection',
    }));
  });
});
