import { SpanKind } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import TypeSafeWrapper from '../typesafe/wrapper';

jest.mock('../../config');
jest.mock('../../helpers', () => ({
  __esModule: true,
  default: {
    handleException: jest.fn(),
    getChatModelCost: jest.fn().mockReturnValue(0.001),
    emitInferenceEvent: jest.fn(),
  },
  applyCustomSpanAttributes: jest.fn(),
}));

describe('TypeSafe wrapper', () => {
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
      recordException: jest.fn(),
    };
    mockTracer = { startSpan: jest.fn(() => mockSpan) };

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
    (OpenlitConfig as any).disableEvents = false;
    (OpenlitConfig as any).pricingInfo = {};
    (OpenLitHelper.getChatModelCost as jest.Mock).mockReturnValue(0.001);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function attrs(): Record<string, any> {
    return Object.fromEntries((mockSpan.setAttribute as jest.Mock).mock.calls);
  }

  it('wraps systemOne into a decision span with TypeSafe attributes', async () => {
    class StubClient {
      defaultModel = 'jev-latest';
      baseURL = 'https://api.typesafe.ai';
      async systemOne(_req: any) {
        return {
          model: 'jev-1.13.0',
          request_id: 'req_123',
          answers: { hallucination: { type: 'noul', noul: 0.2 } },
          usage: { input_tokens: 11, output_tokens: 4 },
        };
      }
    }

    const client = new StubClient();
    const wrapped = TypeSafeWrapper._patchSystemOne(mockTracer)(StubClient.prototype.systemOne);
    const result = await wrapped.call(client, {
      state: { prompt: 'hi' },
      questions: { hallucination: { type: 'noul', instructions: 'flag claims' } },
    });

    expect(result.model).toBe('jev-1.13.0');
    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      'decision jev-latest',
      expect.objectContaining({
        kind: SpanKind.CLIENT,
        attributes: expect.objectContaining({
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION,
          [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_TYPESAFE,
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'jev-latest',
          [SemanticConvention.SERVER_ADDRESS]: 'api.typesafe.ai',
          [SemanticConvention.SERVER_PORT]: 443,
          [SemanticConvention.GEN_AI_REQUEST_STREAM]: false,
        }),
      })
    );

    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_REQUEST_STREAM]).toBe(false);
    expect(a[SemanticConvention.GEN_AI_OUTPUT_TYPE]).toBe(SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON);
    expect(a[SemanticConvention.GEN_AI_RESPONSE_MODEL]).toBe('jev-1.13.0');
    expect(a[SemanticConvention.GEN_AI_RESPONSE_ID]).toBe('req_123');
    expect(a[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]).toBe(11);
    expect(a[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(4);
    expect(a[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE]).toBe(15);
    expect(a[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]).toEqual(['stop']);
    expect(a[SemanticConvention.GEN_AI_SERVER_TBT]).toBe(0);
    expect(a[SemanticConvention.GEN_AI_SERVER_TTFT]).toBeGreaterThanOrEqual(0);
    expect(a[SemanticConvention.TYPESAFE_API_TYPE]).toBe('system_one');
    expect(a[SemanticConvention.TYPESAFE_QUESTION_COUNT]).toBe(1);
    expect(a[SemanticConvention.TYPESAFE_QUESTION_IDS]).toBe('hallucination');
    expect(a[SemanticConvention.TYPESAFE_QUESTION_TYPES]).toBe('noul');
    expect(a[SemanticConvention.GEN_AI_INPUT_MESSAGES]).toContain('hallucination');
    expect(a[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE]).toBeUndefined();
    expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalled();
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('omits message bodies when capture is off but still emits the inference event', async () => {
    (OpenlitConfig as any).captureMessageContent = false;
    class StubClient {
      defaultModel = 'jev-latest';
      baseURL = 'https://api.typesafe.ai';
      async systemOne() {
        return {
          model: 'jev-latest',
          answers: {},
          usage: { input_tokens: 2, output_tokens: 1 },
        };
      }
    }
    const wrapped = TypeSafeWrapper._patchSystemOne(mockTracer)(StubClient.prototype.systemOne);
    await wrapped.call(new StubClient(), { state: 'x', questions: {} });
    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_INPUT_MESSAGES]).toBeUndefined();
    expect(a[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]).toBe(2);
    expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalled();
  });

  it('skips token and cost attributes when usage is null', async () => {
    class StubClient {
      defaultModel = 'jev-latest';
      async systemOne() {
        return {
          model: 'jev-latest',
          answers: {},
          usage: { input_tokens: null, output_tokens: null },
        };
      }
    }
    const wrapped = TypeSafeWrapper._patchSystemOne(mockTracer)(StubClient.prototype.systemOne);
    await wrapped.call(new StubClient(), { state: 'x', questions: {} });
    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]).toBeUndefined();
    expect(a[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]).toBeUndefined();
    expect(a[SemanticConvention.GEN_AI_USAGE_COST]).toBeUndefined();
    expect(a[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE]).toBeUndefined();
    expect(OpenLitHelper.getChatModelCost).not.toHaveBeenCalled();
  });

  it('sets error.type when systemOne throws', async () => {
    class BoomClient {
      defaultModel = 'jev-preview';
      async systemOne() {
        throw new TypeError('boom');
      }
    }
    const wrapped = TypeSafeWrapper._patchSystemOne(mockTracer)(BoomClient.prototype.systemOne);
    await expect(wrapped.call(new BoomClient(), { state: 'x', questions: {} })).rejects.toThrow('boom');
    expect(OpenLitHelper.handleException).toHaveBeenCalled();
    expect(mockSpan.end).toHaveBeenCalled();
  });
});

function loadTypesafeKey(): string | undefined {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  try {
    const text = require('fs').readFileSync('/Users/ishanjain/private/openlit/.env', 'utf8');
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (s.startsWith('TYPESAFE_API_KEY=')) {
        return s.slice('TYPESAFE_API_KEY='.length).trim().replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const liveKey = loadTypesafeKey();
const liveIt = liveKey ? it : it.skip;

describe('TypeSafe live systemOne', () => {
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
      recordException: jest.fn(),
    };
    mockTracer = { startSpan: jest.fn(() => mockSpan) };
    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
    (OpenlitConfig as any).disableEvents = true;
    (OpenlitConfig as any).pricingInfo = {};
  });

  liveIt('wraps a real TypeSafeClient.systemOne call', async () => {
    process.env.TYPESAFE_API_KEY = liveKey;
    let TypeSafeClient: any;
    try {
      ({ TypeSafeClient } = require('@typesafe-ai/sdk'));
    } catch (e) {
      throw new Error(`@typesafe-ai/sdk is required for the live test: ${e}`);
    }
    const client = new TypeSafeClient();
    const wrapped = TypeSafeWrapper._patchSystemOne(mockTracer)(TypeSafeClient.prototype.systemOne);
    const result = await wrapped.call(client, {
      state: {
        prompt: 'What is 2+2?',
        response: '5',
        ground_truth_context: '2+2=4',
      },
      questions: {
        hallucination: {
          type: 'noul',
          instructions: 'Flag invented or contradictory claims versus the ground-truth context.',
        },
        relevance: {
          type: 'score',
          instructions: 'Score how far the response is from answering the prompt.',
          criteria: ['none', 'minor', 'moderate', 'severe'],
        },
      },
      model: 'jev-latest',
    });

    expect(result.model).toBeTruthy();
    expect(result.answers.hallucination.noul).toBeGreaterThanOrEqual(0);
    expect(result.answers.relevance.score).toBeGreaterThanOrEqual(0);
    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      'decision jev-latest',
      expect.objectContaining({
        attributes: expect.objectContaining({
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION,
          [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_TYPESAFE,
        }),
      })
    );
    const a = Object.fromEntries((mockSpan.setAttribute as jest.Mock).mock.calls);
    expect(a[SemanticConvention.GEN_AI_RESPONSE_MODEL]).toBeTruthy();
    expect(a[SemanticConvention.GEN_AI_OUTPUT_TYPE]).toBe(SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON);
    expect(a[SemanticConvention.TYPESAFE_API_TYPE]).toBe('system_one');
    expect(mockSpan.end).toHaveBeenCalled();
  }, 60000);
});
