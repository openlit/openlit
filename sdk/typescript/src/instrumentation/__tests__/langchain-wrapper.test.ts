import { Span, trace } from '@opentelemetry/api';
import { OpenLITCallbackHandler } from '../langchain/wrapper';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';

// `buildOutputMessages` is the observable surface for the fix — we check that
// it receives the normalised toolCalls array (not undefined).
jest.mock('../../../src/helpers', () => ({
  __esModule: true,
  default: {
    buildInputMessages: jest.fn(() => '[]'),
    buildOutputMessages: jest.fn(() => '[]'),
    updatePricingJson: jest.fn(async () => ({})),
    getChatModelCost: jest.fn(() => 0),
  },
}));

jest.mock('../../../src/config', () => ({
  __esModule: true,
  default: {
    traceContent: true,
    pricing_json: {},
    updatePricingJson: jest.fn(async () => ({})),
  },
}));

jest.mock('../../../src/instrumentation/base-wrapper', () => {
  class MockBaseWrapper {
    static setBaseSpanAttributes = jest.fn();
    static recordMetrics = jest.fn();
  }
  return {
    __esModule: true,
    default: MockBaseWrapper,
  };
});

const mockTracer = trace.getTracer('test-tracer');

function makeSpan(): Span {
  const span = mockTracer.startSpan('test-span');
  span.setAttribute = jest.fn();
  return span;
}

function seedRun(
  handler: OpenLITCallbackHandler,
  runId: string,
  span: Span,
  modelName = 'test-model'
) {
  // Reach into the private `spans` map so we don't need a real LangChain
  // callback manager to set up a fake LLM run.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (handler as any).spans.set(runId, {
    span,
    startTime: Date.now() - 10,
    modelName,
    streamingContent: [],
    tokenTimestamps: [],
    promptTokens: 0,
    completionTokens: 0,
  });
}

describe('LangChain wrapper — tool_calls propagation', () => {
  let handler: OpenLITCallbackHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new OpenLITCallbackHandler(mockTracer);
  });

  it('extracts tool_calls from AIMessage and forwards them to buildOutputMessages', async () => {
    const span = makeSpan();
    seedRun(handler, 'run-tc-1', span);

    const output = {
      generations: [
        [
          {
            text: '',
            message: {
              content: '',
              tool_calls: [
                { id: 'call_1', name: 'get_weather', args: { city: 'Tokyo' } },
                { id: 'call_2', name: 'calculator', args: { expression: '2+2' } },
              ],
              response_metadata: { finish_reason: 'tool_calls' },
            },
          },
        ],
      ],
    };

    handler.handleLLMEnd(output, 'run-tc-1');
    // handleLLMEnd → _finalizeLLMSpan is async
    await new Promise((r) => setImmediate(r));

    expect(OpenLitHelper.buildOutputMessages).toHaveBeenCalledTimes(1);
    const [text, finish, toolCalls] = (OpenLitHelper.buildOutputMessages as jest.Mock).mock.calls[0];
    expect(text).toBe('');
    expect(finish).toBe('tool_calls');
    expect(toolCalls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        name: 'get_weather',
        arguments: { city: 'Tokyo' },
      },
      {
        id: 'call_2',
        type: 'function',
        name: 'calculator',
        arguments: { expression: '2+2' },
      },
    ]);

    // Flat attributes for easy filtering
    const setAttr = span.setAttribute as jest.Mock;
    expect(setAttr).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_TOOL_NAME,
      'get_weather, calculator'
    );
    expect(setAttr).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_TOOL_CALL_ID,
      'call_1, call_2'
    );
    const toolArgsCall = setAttr.mock.calls.find(
      (c) => c[0] === SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS
    );
    expect(toolArgsCall).toBeTruthy();
    expect(toolArgsCall?.[1]).toEqual(['{"city":"Tokyo"}', '{"expression":"2+2"}']);
  });

  it('passes undefined as toolCalls for text-only completions (preserves existing behaviour)', async () => {
    const span = makeSpan();
    seedRun(handler, 'run-tc-2', span);

    const output = {
      generations: [
        [
          {
            text: 'Hello world',
            message: {
              content: 'Hello world',
              response_metadata: { finish_reason: 'stop' },
            },
          },
        ],
      ],
    };

    handler.handleLLMEnd(output, 'run-tc-2');
    await new Promise((r) => setImmediate(r));

    const calls = (OpenLitHelper.buildOutputMessages as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    const [text, finish, toolCalls] = calls[0];
    expect(text).toBe('Hello world');
    expect(finish).toBe('stop');
    expect(toolCalls).toBeUndefined();

    // Flat tool attributes must NOT be set
    const setAttr = span.setAttribute as jest.Mock;
    const toolNameCall = setAttr.mock.calls.find(
      (c) => c[0] === SemanticConvention.GEN_AI_TOOL_NAME
    );
    expect(toolNameCall).toBeUndefined();
  });

  it('still emits output.messages when only tool_calls are present (no assistant text)', async () => {
    const span = makeSpan();
    seedRun(handler, 'run-tc-3', span);

    const output = {
      generations: [
        [
          {
            text: '',
            message: {
              content: '',
              tool_calls: [{ id: 'call_only', name: 'ping', args: {} }],
              response_metadata: { finish_reason: 'tool_calls' },
            },
          },
        ],
      ],
    };

    handler.handleLLMEnd(output, 'run-tc-3');
    await new Promise((r) => setImmediate(r));

    const setAttr = span.setAttribute as jest.Mock;
    const outputMsgCall = setAttr.mock.calls.find(
      (c) => c[0] === SemanticConvention.GEN_AI_OUTPUT_MESSAGES
    );
    expect(outputMsgCall).toBeTruthy();
    expect(OpenLitHelper.buildOutputMessages).toHaveBeenCalledTimes(1);
  });

  it('reads tool_calls from additional_kwargs when not on the top-level message', async () => {
    const span = makeSpan();
    seedRun(handler, 'run-tc-4', span);

    const output = {
      generations: [
        [
          {
            text: '',
            message: {
              content: '',
              additional_kwargs: {
                tool_calls: [
                  {
                    id: 'legacy_1',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"k":"v"}' },
                  },
                ],
              },
              response_metadata: { finish_reason: 'tool_calls' },
            },
          },
        ],
      ],
    };

    handler.handleLLMEnd(output, 'run-tc-4');
    await new Promise((r) => setImmediate(r));

    const [, , toolCalls] = (OpenLitHelper.buildOutputMessages as jest.Mock).mock.calls[0];
    expect(toolCalls).toEqual([
      { id: 'legacy_1', type: 'function', name: 'lookup', arguments: '{"k":"v"}' },
    ]);
  });
});
