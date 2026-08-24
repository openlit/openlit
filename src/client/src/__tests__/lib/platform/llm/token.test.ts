jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn().mockResolvedValue({ data: [] }),
  OTEL_TRACES_TABLE_NAME: 'otel_traces',
}));
// Isolate the built-in ClickHouse SQL path: the external-source router pulls in
// the telemetry-source/next-auth chain (ESM `jose`) which Jest cannot parse.
// Returning null routes every helper to the built-in SQL branch under test.
jest.mock('@/lib/platform/llm/external', () => ({
  externalTotalCost: jest.fn().mockResolvedValue(null),
  externalAverageCost: jest.fn().mockResolvedValue(null),
  externalCostPerTime: jest.fn().mockResolvedValue(null),
  externalAverageTokens: jest.fn().mockResolvedValue(null),
  externalTokensPerTime: jest.fn().mockResolvedValue(null),
  externalGenerationByCategories: jest.fn().mockResolvedValue(null),
  externalGenerationByProvider: jest.fn().mockResolvedValue(null),
  externalTopModels: jest.fn().mockResolvedValue(null),
  externalCostByApplication: jest.fn().mockResolvedValue(null),
  externalCostByEnvironment: jest.fn().mockResolvedValue(null),
  externalModelsPerTime: jest.fn().mockResolvedValue(null),
}));

import { getAverageTokensPerRequest, getTokensPerTime } from '@/lib/platform/llm/token';
import { dataCollector } from '@/lib/platform/common';

const baseParams = {
  timeLimit: {
    start: new Date('2024-01-01'),
    end: new Date('2024-01-31'),
    type: '1M',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getAverageTokensPerRequest', () => {
  it('builds a JOIN query for type=total', async () => {
    await getAverageTokensPerRequest({ ...baseParams, type: 'total' });
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('total_tokens');
    expect(query).toContain('JOIN');
    expect(query).toContain('previous_total_tokens');
  });

  it('builds a simple query for type=prompt', async () => {
    await getAverageTokensPerRequest({ ...baseParams, type: 'prompt' });
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('total_tokens');
    expect(query).not.toContain('JOIN');
  });

  it('builds a simple query for type=completion', async () => {
    await getAverageTokensPerRequest({ ...baseParams, type: 'completion' });
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('total_tokens');
    expect(query).not.toContain('JOIN');
  });

  it('uses if() fallback for backward-compatible token attributes (total)', async () => {
    await getAverageTokensPerRequest({ ...baseParams, type: 'total' });
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain("gen_ai.usage.total_tokens");
    expect(query).toContain("gen_ai.client.token.usage");
    expect(query).toMatch(/if\(/);
  });

  it('uses if() fallback for backward-compatible token attributes (prompt)', async () => {
    await getAverageTokensPerRequest({ ...baseParams, type: 'prompt' });
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain("gen_ai.usage.input_tokens");
    expect(query).toContain("gen_ai.client.token.usage.input");
    expect(query).toMatch(/if\(/);
  });

  it('uses if() fallback for backward-compatible token attributes (completion)', async () => {
    await getAverageTokensPerRequest({ ...baseParams, type: 'completion' });
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain("gen_ai.usage.output_tokens");
    expect(query).toContain("gen_ai.client.token.usage.output");
    expect(query).toMatch(/if\(/);
  });
});

describe('getTokensPerTime', () => {
  it('calls dataCollector with time-series token query', async () => {
    await getTokensPerTime(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('totaltokens');
    expect(query).toContain('prompttokens');
    expect(query).toContain('completiontokens');
    expect(query).toContain('GROUP BY');
    expect(query).toContain('request_time');
  });

  it('uses if() fallback for all three token types', async () => {
    await getTokensPerTime(baseParams);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    // Primary paths
    expect(query).toContain("gen_ai.usage.total_tokens");
    expect(query).toContain("gen_ai.usage.input_tokens");
    expect(query).toContain("gen_ai.usage.output_tokens");
    // Fallback paths
    expect(query).toContain("gen_ai.client.token.usage'");
    expect(query).toContain("gen_ai.client.token.usage.input");
    expect(query).toContain("gen_ai.client.token.usage.output");
    // if() coalesce pattern
    expect((query.match(/if\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
