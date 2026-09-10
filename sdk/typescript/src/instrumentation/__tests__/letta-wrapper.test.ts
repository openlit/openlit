import { SpanKind } from '@opentelemetry/api';
import { isTracingSuppressed } from '@opentelemetry/core';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import LettaWrapper from '../letta/wrapper';
import LettaInstrumentation from '../letta';

jest.mock('../../config');
jest.mock('../../helpers', () => ({
  __esModule: true,
  default: {
    handleException: jest.fn(),
    getChatModelCost: jest.fn().mockReturnValue(0.0025),
    createStreamProxy: async (stream: any, gen: any) =>
      new Proxy(stream, {
        get(target, prop, receiver) {
          if (prop === Symbol.asyncIterator) return () => gen;
          return Reflect.get(target, prop, receiver);
        },
      }),
  },
  applyCustomSpanAttributes: jest.fn(),
}));
jest.mock('@opentelemetry/core', () => ({
  isTracingSuppressed: jest.fn().mockReturnValue(false),
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('letta wrapper', () => {
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
      recordException: jest.fn(),
      isRecording: jest.fn().mockReturnValue(true),
    };
    mockTracer = { startSpan: jest.fn(() => mockSpan) };

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
    (OpenlitConfig as any).maxContentLength = null;
    (OpenlitConfig as any).pricingInfo = { chat: {} };
    (isTracingSuppressed as jest.Mock).mockReturnValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function attrs(): Record<string, any> {
    return Object.fromEntries((mockSpan.setAttribute as jest.Mock).mock.calls);
  }

  async function runOp(
    endpoint: string,
    impl: (...a: any[]) => any,
    args: any[],
    agentScoped = true
  ) {
    const wrapped = LettaWrapper._patchOperation(mockTracer, endpoint, agentScoped, '1.12.1')(impl);
    const result = await wrapped.apply({}, args);
    await flush();
    return result;
  }

  it('opens a create_agent span with agent metadata', async () => {
    const agent = {
      id: 'agent-123',
      name: 'Support Bot',
      agent_type: 'memgpt_agent',
      system: 'You are a helpful assistant.',
      llm_config: { model: 'gpt-4o-mini', provider_name: 'openai', context_window: 8192 },
    };
    await runOp('letta.create', async () => agent, [{ name: 'Support Bot', model: 'gpt-4o-mini' }]);

    expect(mockTracer.startSpan).toHaveBeenCalledWith('create_agent support_bot', {
      kind: SpanKind.CLIENT,
      attributes: {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_LETTA,
      },
    });

    const a = attrs();
    expect(a[ATTR_TELEMETRY_SDK_NAME]).toBe('openlit');
    expect(a[ATTR_SERVICE_NAME]).toBe('openlit-test');
    expect(a[SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]).toBe('openlit-testing');
    expect(a[SemanticConvention.GEN_AI_PROVIDER_NAME]).toBe('letta');
    expect(a[SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]).toBe('letta');
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('create_agent');
    expect(a[SemanticConvention.GEN_AI_SDK_VERSION]).toBe('1.12.1');
    expect(a[SemanticConvention.SERVER_ADDRESS]).toBe('api.letta.com');
    expect(a[SemanticConvention.SERVER_PORT]).toBe(443);
    expect(a[SemanticConvention.GEN_AI_AGENT_ID]).toBe('agent-123');
    expect(a[SemanticConvention.GEN_AI_AGENT_NAME]).toBe('Support Bot');
    expect(a[SemanticConvention.GEN_AI_AGENT_TYPE]).toBe('memgpt_agent');
    expect(a[SemanticConvention.GEN_AI_AGENT_INSTRUCTIONS]).toBe('You are a helpful assistant.');
    expect(a[SemanticConvention.GEN_AI_REQUEST_MODEL]).toBe('gpt-4o-mini');
    expect(a[SemanticConvention.GEN_AI_REQUEST_CONTEXT_WINDOW]).toBe(8192);
    expect(typeof a[SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION]).toBe('number');
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('applies custom span attributes on every span', async () => {
    const { applyCustomSpanAttributes } = jest.requireMock('../../helpers');
    await runOp('letta.retrieve', async () => ({ id: 'agent-1' }), ['agent-1']);
    expect(applyCustomSpanAttributes).toHaveBeenCalledWith(mockSpan);
  });

  it('names a message create span chat {model} and records usage + cost', async () => {
    const response = {
      messages: [{ message_type: 'assistant_message', content: 'Hi there' }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, step_count: 1 },
    };
    await runOp('letta.create_message', async () => response, [
      'agent-1',
      { messages: [{ role: 'user', content: 'hello' }], model: 'gpt-4o' },
    ]);

    expect(mockTracer.startSpan).toHaveBeenCalledWith('chat gpt-4o', {
      kind: SpanKind.CLIENT,
      attributes: {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_LETTA,
      },
    });

    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('chat');
    expect(a[SemanticConvention.GEN_AI_AGENT_ID]).toBe('agent-1');
    expect(a[SemanticConvention.GEN_AI_REQUEST_MESSAGE_COUNT]).toBe(1);
    expect(a[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]).toBe(12);
    expect(a[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(4);
    expect(a[SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS]).toBe(16);
    expect(a[SemanticConvention.GEN_AI_AGENT_STEP_COUNT]).toBe(1);
    expect(a[SemanticConvention.GEN_AI_USAGE_COST]).toBe(0.0025);
    expect(JSON.parse(a[SemanticConvention.GEN_AI_INPUT_MESSAGES])).toEqual([
      { role: 'user', content: 'hello' },
    ]);
    expect(JSON.parse(a[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])).toEqual(response.messages);
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('wraps a streaming message response and records streaming attributes', async () => {
    async function* stream() {
      yield { message_type: 'assistant_message', content: 'Hel' };
      yield { message_type: 'assistant_message', content: 'lo' };
      yield {
        message_type: 'usage_statistics',
        prompt_tokens: 8,
        completion_tokens: 2,
        total_tokens: 10,
      };
    }

    const proxy = await runOp('letta.create_stream', () => stream(), [
      'agent-1',
      { messages: [{ role: 'user', content: 'hi' }] },
    ]);

    const seen: any[] = [];
    for await (const chunk of proxy) {
      seen.push(chunk);
    }
    await flush();

    expect(seen).toHaveLength(3);
    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('chat');
    expect(a[SemanticConvention.GEN_AI_STREAMING_CHUNK_COUNT]).toBe(3);
    expect(a[SemanticConvention.GEN_AI_STREAMING_RESPONSE_COUNT]).toBe(3);
    expect(a[SemanticConvention.GEN_AI_REQUEST_IS_STREAM]).toBe(true);
    expect(a[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]).toBe(8);
    expect(a[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(2);
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('names list operations workflow {method}', async () => {
    await runOp('letta.list', async () => [{ id: 'b1' }, { id: 'b2' }], [{}]);

    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      'workflow list',
      expect.objectContaining({ kind: SpanKind.CLIENT })
    );
    expect(attrs()[SemanticConvention.GEN_AI_OPERATION]).toBe('workflow');
  });

  it('names attach/detach operations tool {method} with execute_tool op', async () => {
    await runOp('letta.attach', async () => ({ id: 'agent-1' }), ['tool-1', { agent_id: 'agent-1' }]);

    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      'tool attach',
      expect.objectContaining({ kind: SpanKind.CLIENT })
    );
    expect(attrs()[SemanticConvention.GEN_AI_OPERATION]).toBe('execute_tool');
  });

  it('records the exception, ends the span, and rethrows on a chat error', async () => {
    const boom = new Error('letta down');
    const wrapped = LettaWrapper._patchOperation(mockTracer, 'letta.create_message', true)(async () => {
      throw boom;
    });

    await expect(wrapped.apply({}, ['agent-1', { messages: [] }])).rejects.toThrow('letta down');

    expect((OpenLitHelper as any).handleException).toHaveBeenCalledWith(mockSpan, boom);
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
    expect(attrs()[SemanticConvention.GEN_AI_PROVIDER_NAME]).toBe('letta');
  });

  it('ends the stream span exactly once when the consumer breaks early', async () => {
    async function* stream() {
      yield { message_type: 'assistant_message', content: 'one' };
      yield { message_type: 'assistant_message', content: 'two' };
    }

    const proxy = await runOp('letta.create_stream', () => stream(), [
      'agent-1',
      { messages: [{ role: 'user', content: 'hi' }] },
    ]);

    for await (const _chunk of proxy) {
      break;
    }
    await flush();

    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('does not treat a top-level resource id as an agent id', async () => {
    await runOp('letta.retrieve', async () => ({ label: 'persona' }), ['block-id'], false);
    expect(attrs()[SemanticConvention.GEN_AI_AGENT_ID]).not.toBe('block-id');
  });

  it('maps an agent update to the invoke_agent operation', async () => {
    await runOp('letta.modify', async () => ({ id: 'agent-1' }), ['agent-1', { name: 'renamed' }]);
    expect(attrs()[SemanticConvention.GEN_AI_OPERATION]).toBe('invoke_agent');
  });

  it('rejects and ends the span on a non-chat operation error', async () => {
    const boom = new Error('list failed');
    const wrapped = LettaWrapper._patchOperation(mockTracer, 'letta.list', false)(async () => {
      throw boom;
    });

    await expect(wrapped.apply({}, [{}])).rejects.toThrow('list failed');
    await flush();

    expect((OpenLitHelper as any).handleException).toHaveBeenCalledWith(mockSpan, boom);
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('bypasses instrumentation when tracing is suppressed', async () => {
    (isTracingSuppressed as jest.Mock).mockReturnValue(true);
    const original = jest.fn().mockResolvedValue({ id: 'agent-1' });
    const wrapped = LettaWrapper._patchOperation(mockTracer, 'letta.create', false)(original);

    await wrapped.apply({}, [{ name: 'bot' }]);
    expect(original).toHaveBeenCalled();
    expect(mockTracer.startSpan).not.toHaveBeenCalled();
  });
});

describe('LettaInstrumentation patch targets', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isWrapped } = require('@opentelemetry/instrumentation');

  it('wraps resource-client prototype methods via manualPatch', () => {
    class Agents {
      async create() {
        return null;
      }
      async retrieve() {
        return null;
      }
      async update() {
        return null;
      }
      async delete() {
        return null;
      }
      async list() {
        return null;
      }
    }
    class Messages {
      async create() {
        return null;
      }
      async stream() {
        return null;
      }
      async createAsync() {
        return null;
      }
      async list() {
        return null;
      }
      async cancel() {
        return null;
      }
      async reset() {
        return null;
      }
    }

    const fakeModule = { Agents, Messages } as any;
    const instrumentation = new LettaInstrumentation();
    instrumentation.manualPatch(fakeModule);

    for (const method of ['create', 'retrieve', 'update', 'delete', 'list']) {
      expect(isWrapped(Agents.prototype[method as keyof typeof Agents.prototype])).toBe(true);
    }
    for (const method of ['create', 'stream', 'createAsync', 'list', 'cancel', 'reset']) {
      expect(isWrapped(Messages.prototype[method as keyof typeof Messages.prototype])).toBe(true);
    }

    // Idempotent: a second patch must not throw or rewrap.
    instrumentation.manualPatch(fakeModule);
    expect(isWrapped(Agents.prototype.create)).toBe(true);
  });
});
