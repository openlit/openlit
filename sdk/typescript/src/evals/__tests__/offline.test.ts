import { runEval, runEvalBatch, fetchEvalTypes, formatSummary, formatBatchSummary } from '../offline';
import { isPassed, getFailedEvals, isAllPassed, getPassRate, OfflineEvalResult, BatchEvalResult } from '../types';
import OpenlitConfig from '../../config';

const MOCK_SUCCESS_BODY = {
  success: true,
  evaluations: [
    { type: 'hallucination', score: 0.85, verdict: 'yes', classification: 'factual_inaccuracy', explanation: 'Response contradicts context' },
    { type: 'toxicity', score: 0.1, verdict: 'no', classification: 'none', explanation: 'No toxicity detected' },
  ],
  context_applied: {
    ruleMatched: true,
    matchingRuleIds: ['rule-1'],
    contextEntityIds: ['ctx-a'],
    userContextsCount: 1,
  },
  metadata: { model: 'gpt-4', runId: 'test-run-1' },
};

function mockFetchResponse(body: any, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response);
}

beforeEach(() => {
  jest.restoreAllMocks();
  OpenlitConfig.openlitApiKey = undefined;
  OpenlitConfig.openlitUrl = undefined;
  OpenlitConfig.applicationName = undefined;
  OpenlitConfig.environment = undefined;
  delete process.env.OPENLIT_API_KEY;
  delete process.env.OPENLIT_URL;
  delete process.env.OTEL_SERVICE_NAME;
  delete process.env.OTEL_RESOURCE_ATTRIBUTES;
  delete process.env.OTEL_DEPLOYMENT_ENVIRONMENT;
  delete process.env.OPENLIT_ENVIRONMENT;
});

describe('runEval', () => {
  test('resolves API key from explicit param', async () => {
    const fetchMock = mockFetchResponse(MOCK_SUCCESS_BODY);
    global.fetch = fetchMock;

    const result = await runEval({
      prompt: 'test', response: 'test',
      openlitApiKey: 'key-explicit', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/evaluation/offline',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer key-explicit' }),
      }),
    );
  });

  test('resolves API key from OpenlitConfig', async () => {
    OpenlitConfig.openlitApiKey = 'key-config';
    OpenlitConfig.openlitUrl = 'http://localhost:3000';
    const fetchMock = mockFetchResponse(MOCK_SUCCESS_BODY);
    global.fetch = fetchMock;

    await runEval({ prompt: 'test', response: 'test', printResults: false });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer key-config' }),
      }),
    );
  });

  test('resolves API key from env var', async () => {
    process.env.OPENLIT_API_KEY = 'key-env';
    process.env.OPENLIT_URL = 'http://localhost:3000';
    const fetchMock = mockFetchResponse(MOCK_SUCCESS_BODY);
    global.fetch = fetchMock;

    await runEval({ prompt: 'test', response: 'test', printResults: false });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer key-env' }),
      }),
    );
  });

  test('throws when API key is missing', async () => {
    await expect(runEval({
      prompt: 'test', response: 'test', openlitUrl: 'http://localhost:3000', printResults: false,
    })).rejects.toThrow('Missing OpenLIT API key');
  });

  test('throws when URL is missing', async () => {
    await expect(runEval({
      prompt: 'test', response: 'test', openlitApiKey: 'key', printResults: false,
    })).rejects.toThrow('Missing OpenLIT URL');
  });

  test('strips trailing slashes from URL', async () => {
    const fetchMock = mockFetchResponse(MOCK_SUCCESS_BODY);
    global.fetch = fetchMock;

    await runEval({
      prompt: 'test', response: 'test',
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000///',
      printResults: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/evaluation/offline',
      expect.anything(),
    );
  });

  test('parses successful response with evaluations and context', async () => {
    global.fetch = mockFetchResponse(MOCK_SUCCESS_BODY);

    const result = await runEval({
      prompt: 'What is the capital?', response: 'Lyon',
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    expect(result.success).toBe(true);
    expect(result.evaluations).toHaveLength(2);
    expect(result.evaluations[0].type).toBe('hallucination');
    expect(result.evaluations[0].score).toBe(0.85);
    expect(result.evaluations[1].verdict).toBe('no');
    expect(result.contextApplied?.ruleMatched).toBe(true);
    expect(result.contextApplied?.matchingRuleIds).toEqual(['rule-1']);
    expect(result.metadata?.model).toBe('gpt-4');
  });

  test('handles 401 authentication failure', async () => {
    global.fetch = mockFetchResponse({ err: 'unauthorized' }, 401);

    const result = await runEval({
      prompt: 'test', response: 'test',
      openlitApiKey: 'bad-key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication failed');
  });

  test('handles non-JSON error response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 502,
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    } as unknown as Response);

    const result = await runEval({
      prompt: 'test', response: 'test',
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('non-JSON');
  });

  test('retries on 429 then succeeds', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false, status: 429,
          json: jest.fn().mockResolvedValue({ err: 'rate limited' }),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: jest.fn().mockResolvedValue(MOCK_SUCCESS_BODY),
      });
    }) as jest.Mock;

    const result = await runEval({
      prompt: 'test', response: 'test',
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });

  test('sends evalTypes and contexts in payload', async () => {
    const fetchMock = mockFetchResponse(MOCK_SUCCESS_BODY);
    global.fetch = fetchMock;

    await runEval({
      prompt: 'test', response: 'test',
      contexts: ['ctx1', 'ctx2'],
      evalTypes: ['hallucination'],
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.contexts).toEqual(['ctx1', 'ctx2']);
    expect(body.eval_types).toEqual(['hallucination']);
  });
});

describe('resolveAttributes', () => {
  test('picks up OTEL_SERVICE_NAME and OTEL_DEPLOYMENT_ENVIRONMENT', async () => {
    process.env.OTEL_SERVICE_NAME = 'my-svc';
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT = 'staging';

    const fetchMock = mockFetchResponse(MOCK_SUCCESS_BODY);
    global.fetch = fetchMock;

    await runEval({
      prompt: 'test', response: 'test',
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.attributes['service.name']).toBe('my-svc');
    expect(body.attributes['deployment.environment']).toBe('staging');
  });

  test('OpenlitConfig overrides OTEL env vars', async () => {
    process.env.OTEL_SERVICE_NAME = 'otel-svc';
    OpenlitConfig.applicationName = 'config-svc';

    const fetchMock = mockFetchResponse(MOCK_SUCCESS_BODY);
    global.fetch = fetchMock;

    await runEval({
      prompt: 'test', response: 'test',
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.attributes['service.name']).toBe('config-svc');
  });

  test('explicit attributes take highest priority', async () => {
    OpenlitConfig.applicationName = 'config-svc';

    const fetchMock = mockFetchResponse(MOCK_SUCCESS_BODY);
    global.fetch = fetchMock;

    await runEval({
      prompt: 'test', response: 'test',
      attributes: { 'service.name': 'explicit-svc' },
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.attributes['service.name']).toBe('explicit-svc');
  });

  test('parses OTEL_RESOURCE_ATTRIBUTES', async () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.name=res-svc,custom.tag=v1';

    const fetchMock = mockFetchResponse(MOCK_SUCCESS_BODY);
    global.fetch = fetchMock;

    await runEval({
      prompt: 'test', response: 'test',
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.attributes['custom.tag']).toBe('v1');
  });
});

describe('runEvalBatch', () => {
  test('evaluates two items and returns batch result', async () => {
    global.fetch = mockFetchResponse(MOCK_SUCCESS_BODY);

    const result = await runEvalBatch({
      dataset: [
        { prompt: 'p1', response: 'r1' },
        { prompt: 'p2', response: 'r2' },
      ],
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    expect(result.results).toHaveLength(2);
    expect(result.runId).toBeDefined();
    expect(result.results[0].success).toBe(true);
  });

  test('throws on empty dataset', async () => {
    await expect(runEvalBatch({
      dataset: [],
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    })).rejects.toThrow('non-empty array');
  });

  test('throws on missing prompt in dataset item', async () => {
    await expect(runEvalBatch({
      dataset: [{ prompt: 'ok', response: 'ok' }, { prompt: '', response: 'r' } as any],
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    })).rejects.toThrow("dataset[1] must have a 'prompt' string property");
  });

  test('throws on missing response in dataset item', async () => {
    await expect(runEvalBatch({
      dataset: [{ prompt: 'ok', response: 'ok' }, { prompt: 'p', response: '' } as any],
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    })).rejects.toThrow("dataset[1] must have a 'response' string property");
  });

  test('throws on non-object dataset item', async () => {
    await expect(runEvalBatch({
      dataset: ['not-an-object'] as any,
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    })).rejects.toThrow('must be an object');
  });

  test('uses custom runId when provided', async () => {
    global.fetch = mockFetchResponse(MOCK_SUCCESS_BODY);

    const result = await runEvalBatch({
      dataset: [{ prompt: 'p', response: 'r' }],
      runId: 'my-run',
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
      printResults: false,
    });

    expect(result.runId).toBe('my-run');
  });
});

describe('fetchEvalTypes', () => {
  test('returns parsed eval types', async () => {
    global.fetch = mockFetchResponse({
      eval_types: [
        { id: 'hallucination', label: 'Hallucination', description: 'Detect hallucinated facts', enabled: true, is_custom: false },
        { id: 'custom_1', label: 'Custom', description: 'User-defined', enabled: true, is_custom: true },
      ],
    });

    const types = await fetchEvalTypes({ openlitApiKey: 'key', openlitUrl: 'http://localhost:3000' });
    expect(types).toHaveLength(2);
    expect(types[0].id).toBe('hallucination');
    expect(types[0].isCustom).toBe(false);
    expect(types[1].isCustom).toBe(true);
  });

  test('throws on 401', async () => {
    global.fetch = mockFetchResponse({ err: 'unauthorized' }, 401);

    await expect(fetchEvalTypes({
      openlitApiKey: 'bad-key', openlitUrl: 'http://localhost:3000',
    })).rejects.toThrow('Authentication failed');
  });

  test('throws on connection error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed'));

    await expect(fetchEvalTypes({
      openlitApiKey: 'key', openlitUrl: 'http://localhost:3000',
    })).rejects.toThrow('fetch failed');
  });
});

describe('helper functions', () => {
  const passedResult: OfflineEvalResult = {
    success: true,
    evaluations: [
      { type: 'toxicity', score: 0.1, verdict: 'no', classification: 'none', explanation: 'Clean' },
    ],
  };

  const failedResult: OfflineEvalResult = {
    success: true,
    evaluations: [
      { type: 'hallucination', score: 0.9, verdict: 'yes', classification: 'factual', explanation: 'Wrong' },
      { type: 'toxicity', score: 0.1, verdict: 'no', classification: 'none', explanation: 'Clean' },
    ],
  };

  const errorResult: OfflineEvalResult = {
    success: false,
    evaluations: [],
    error: 'Server error',
  };

  test('isPassed returns true for passing result', () => {
    expect(isPassed(passedResult)).toBe(true);
  });

  test('isPassed returns false for failed result', () => {
    expect(isPassed(failedResult)).toBe(false);
  });

  test('isPassed returns false for error result', () => {
    expect(isPassed(errorResult)).toBe(false);
  });

  test('getFailedEvals returns failing evaluations', () => {
    const failed = getFailedEvals(failedResult);
    expect(failed).toHaveLength(1);
    expect(failed[0].type).toBe('hallucination');
  });

  test('getFailedEvals returns empty for passing result', () => {
    expect(getFailedEvals(passedResult)).toHaveLength(0);
  });

  test('isAllPassed returns true when all pass', () => {
    const batch: BatchEvalResult = { results: [passedResult, passedResult] };
    expect(isAllPassed(batch)).toBe(true);
  });

  test('isAllPassed returns false when any fail', () => {
    const batch: BatchEvalResult = { results: [passedResult, failedResult] };
    expect(isAllPassed(batch)).toBe(false);
  });

  test('isAllPassed returns false for empty results', () => {
    const batch: BatchEvalResult = { results: [] };
    expect(isAllPassed(batch)).toBe(false);
  });

  test('getPassRate calculates correctly', () => {
    const batch: BatchEvalResult = { results: [passedResult, failedResult, passedResult] };
    expect(getPassRate(batch)).toBeCloseTo(2 / 3);
  });

  test('getPassRate returns 0 for empty results', () => {
    expect(getPassRate({ results: [] })).toBe(0);
  });
});

describe('formatSummary', () => {
  test('formats successful result', () => {
    const result: OfflineEvalResult = {
      success: true,
      evaluations: [
        { type: 'hallucination', score: 0.85, verdict: 'yes', classification: 'factual', explanation: 'Wrong fact' },
      ],
    };
    const output = formatSummary(result);
    expect(output).toContain('FAILED');
    expect(output).toContain('hallucination');
    expect(output).toContain('0.85');
  });

  test('formats error result', () => {
    const result: OfflineEvalResult = { success: false, evaluations: [], error: 'Connection refused' };
    const output = formatSummary(result);
    expect(output).toContain('Connection refused');
  });

  test('formats context info', () => {
    const result: OfflineEvalResult = {
      success: true,
      evaluations: [{ type: 'toxicity', score: 0.1, verdict: 'no', classification: 'none', explanation: '' }],
      contextApplied: { ruleMatched: true, matchingRuleIds: ['r1'], contextEntityIds: ['c1', 'c2'], userContextsCount: 0 },
    };
    const output = formatSummary(result);
    expect(output).toContain('2 entities');
    expect(output).toContain('1 rules');
  });
});

describe('formatBatchSummary', () => {
  test('formats batch with mixed results', () => {
    const batch: BatchEvalResult = {
      results: [
        { success: true, evaluations: [{ type: 'toxicity', score: 0.1, verdict: 'no', classification: 'none', explanation: '' }] },
        { success: true, evaluations: [{ type: 'hallucination', score: 0.9, verdict: 'yes', classification: 'factual', explanation: '' }] },
      ],
      runId: 'test-batch',
    };
    const output = formatBatchSummary(batch);
    expect(output).toContain('1 FAILED');
    expect(output).toContain('50%');
    expect(output).toContain('test-batch');
  });

  test('formats all-passed batch', () => {
    const batch: BatchEvalResult = {
      results: [
        { success: true, evaluations: [{ type: 'toxicity', score: 0.1, verdict: 'no', classification: 'none', explanation: '' }] },
      ],
    };
    const output = formatBatchSummary(batch);
    expect(output).toContain('ALL PASSED');
  });
});
