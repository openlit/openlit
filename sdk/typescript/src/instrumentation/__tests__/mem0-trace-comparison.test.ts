/**
 * Cross-Language Trace Comparison Tests for the mem0 Integration
 *
 * These verify that the TypeScript mem0 instrumentation emits the same spans /
 * attributes as the Python SDK reference
 * (sdk/python/src/openlit/instrumentation/mem0). mem0 is a memory layer, not an LLM
 * provider: each operation (add / search / get / getAll / update / delete /
 * deleteAll / history) becomes one CLIENT span named `memory <op>` carrying
 * `gen_ai.*` attributes. There are no tokens, model, cost, or metrics. The same
 * wrapper serves both the hosted `MemoryClient` and the OSS `Memory` clients, whose
 * method surfaces are identical.
 */

import { SpanKind } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import Mem0Wrapper from '../mem0/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers', () => ({
  __esModule: true,
  default: { handleException: jest.fn() },
  applyCustomSpanAttributes: jest.fn(),
}));

describe('mem0 Cross-Language Trace Comparison', () => {
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
    };
    mockTracer = { startSpan: jest.fn(() => mockSpan) };

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Wrap `impl` as the mem0 operation `spanName`, then invoke it with `args`.
  async function runOp(spanName: string, impl: (...a: any[]) => any, args: any[] = []) {
    const wrapped = Mem0Wrapper._patchMemoryOperation(mockTracer, spanName)(impl);
    return wrapped.apply({}, args);
  }

  // Snapshot of all setAttribute(key, value) calls as a plain object.
  function attrs(): Record<string, any> {
    return Object.fromEntries((mockSpan.setAttribute as jest.Mock).mock.calls);
  }

  describe('Core span shape', () => {
    it('opens a CLIENT span named after the Python endpoint string', async () => {
      await runOp('memory add', async () => [{ id: 'm1' }], [[{ role: 'user', content: 'hi' }], {}]);

      expect(mockTracer.startSpan).toHaveBeenCalledWith('memory add', { kind: SpanKind.CLIENT });
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // SpanStatusCode.OK
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('sets the same core attributes as the Python SDK', async () => {
      await runOp('memory add', async () => [{ id: 'm1' }], [[{ role: 'user', content: 'hi' }], {}]);
      const a = attrs();

      expect(a[ATTR_TELEMETRY_SDK_NAME]).toBe('openlit');
      // Provider name is stamped on BOTH keys (gen_ai.system + gen_ai.provider.name).
      expect(a[SemanticConvention.GEN_AI_PROVIDER_NAME]).toBe('mem0');
      expect(a[SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]).toBe('mem0');
      expect(a[SemanticConvention.GEN_AI_ENDPOINT]).toBe('memory add');
      expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe(SemanticConvention.GEN_AI_OPERATION_TYPE_MEMORY);
      expect(a[SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]).toBe('openlit-testing');
      expect(a[ATTR_SERVICE_NAME]).toBe('openlit-test');
      // gen_ai.sdk.version is the mem0ai package version (a string); its exact value
      // comes from the version OTel passes to the patch hook — asserted in the next test.
      expect(typeof a[SemanticConvention.GEN_AI_SDK_VERSION]).toBe('string');
      expect(typeof a[SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION]).toBe('number');
    });

    it('stamps the mem0ai version OTel hands to the patch hook', async () => {
      const wrapped = Mem0Wrapper._patchMemoryOperation(mockTracer, 'memory add', '3.0.7')(
        async () => [{ id: 'm1' }]
      );
      await wrapped.apply({}, [[{ role: 'user', content: 'hi' }], {}]);
      expect(attrs()[SemanticConvention.GEN_AI_SDK_VERSION]).toBe('3.0.7');
    });

    it('applies custom span attributes on every memory span', async () => {
      const { applyCustomSpanAttributes } = jest.requireMock('../../helpers');
      await runOp('memory get', async () => ({ id: 'm1' }), ['mem-123']);
      expect(applyCustomSpanAttributes).toHaveBeenCalledWith(mockSpan);
    });
  });

  describe('Operation: add', () => {
    it('records message count, infer flag, and input content', async () => {
      const messages = [
        { role: 'user', content: 'I love coffee' },
        { role: 'assistant', content: 'Noted' },
      ];
      await runOp('memory add', async () => ({ results: [{ id: 'm1' }] }), [
        messages,
        { userId: 'alice', infer: false },
      ]);
      const a = attrs();

      expect(a[SemanticConvention.GEN_AI_MEMORY_COUNT]).toBe(2);
      expect(a[SemanticConvention.GEN_AI_MEMORY_INFER]).toBe(false);
      expect(a[SemanticConvention.GEN_AI_USER_ID]).toBe('alice');
      expect(a[SemanticConvention.GEN_AI_INPUT_MESSAGES]).toBe(JSON.stringify(messages));
    });

    it('captures user / agent / run scope from the config object', async () => {
      await runOp('memory add', async () => [{ id: 'm1' }], [
        [{ role: 'user', content: 'hi' }],
        { userId: 'u1', agentId: 'a1', runId: 'r1', metadata: { topic: 'food' } },
      ]);
      const a = attrs();

      expect(a[SemanticConvention.GEN_AI_USER_ID]).toBe('u1');
      expect(a[SemanticConvention.GEN_AI_AGENT_ID]).toBe('a1');
      expect(a[SemanticConvention.GEN_AI_RUN_ID]).toBe('r1');
      expect(a[SemanticConvention.GEN_AI_MEMORY_METADATA]).toBe(JSON.stringify({ topic: 'food' }));
    });
  });

  describe('Operation: search', () => {
    it('records query / limit (topK) / threshold and output content', async () => {
      const response = { results: [{ id: 'm1', memory: 'likes coffee' }, { id: 'm2', memory: 'likes tea' }] };
      await runOp('memory search', async () => response, [
        'what drinks?',
        { userId: 'alice', topK: 5, threshold: 0.7 },
      ]);
      const a = attrs();

      expect(a[SemanticConvention.GEN_AI_MEMORY_SEARCH_QUERY]).toBe('what drinks?');
      expect(a[SemanticConvention.GEN_AI_MEMORY_SEARCH_LIMIT]).toBe(5);
      expect(a[SemanticConvention.GEN_AI_MEMORY_SEARCH_THRESHOLD]).toBe(0.7);
      expect(a[SemanticConvention.GEN_AI_MEMORY_OPERATION_RESULT_COUNT]).toBe(2);
      expect(a[SemanticConvention.GEN_AI_DATA_SOURCES]).toBe(2);
      expect(a[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]).toBe(JSON.stringify(response));
    });

    it('reads scope from a nested filters object (camel or snake case)', async () => {
      await runOp('memory search', async () => ({ results: [] }), [
        'q',
        { filters: { user_id: 'snake-user' } },
      ]);
      expect(attrs()[SemanticConvention.GEN_AI_USER_ID]).toBe('snake-user');
    });

    it('reports result_count 0 for an empty results array (not 1)', async () => {
      await runOp('memory search', async () => ({ results: [] }), ['q', { filters: { user_id: 'x' } }]);
      const a = attrs();
      expect(a[SemanticConvention.GEN_AI_MEMORY_OPERATION_RESULT_COUNT]).toBe(0);
      expect(a[SemanticConvention.GEN_AI_DATA_SOURCES]).toBe(0);
    });
  });

  describe('Operations carrying a positional memory id', () => {
    it('get -> db.operation.id', async () => {
      await runOp('memory get', async () => ({ id: 'mem-1' }), ['mem-1']);
      expect(attrs()[SemanticConvention.DB_OPERATION_ID]).toBe('mem-1');
    });

    it('update -> db.update.id', async () => {
      await runOp('memory update', async () => ({ message: 'ok' }), ['mem-2', 'new text']);
      expect(attrs()[SemanticConvention.DB_UPDATE_ID]).toBe('mem-2');
    });

    it('delete -> db.delete.id', async () => {
      await runOp('memory delete', async () => ({ message: 'ok' }), ['mem-3']);
      expect(attrs()[SemanticConvention.DB_DELETE_ID]).toBe('mem-3');
    });
  });

  describe('Operation: getAll / deleteAll', () => {
    it('getAll uses the snake_case span name and reads scope from its first-arg config', async () => {
      await runOp('memory get_all', async () => ({ results: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] }), [
        { userId: 'bob' },
      ]);
      const a = attrs();

      expect(mockTracer.startSpan).toHaveBeenCalledWith('memory get_all', { kind: SpanKind.CLIENT });
      expect(a[SemanticConvention.GEN_AI_USER_ID]).toBe('bob');
      expect(a[SemanticConvention.GEN_AI_MEMORY_OPERATION_RESULT_COUNT]).toBe(3);
    });

    it('deleteAll uses the snake_case span name', async () => {
      await runOp('memory delete_all', async () => ({ message: 'ok' }), [{ userId: 'bob' }]);
      expect(mockTracer.startSpan).toHaveBeenCalledWith('memory delete_all', { kind: SpanKind.CLIENT });
    });

    it('reset uses the Python endpoint span name', async () => {
      await runOp('memory reset', async () => ({ message: 'ok' }), []);
      expect(mockTracer.startSpan).toHaveBeenCalledWith('memory reset', { kind: SpanKind.CLIENT });
      expect(attrs()[SemanticConvention.GEN_AI_ENDPOINT]).toBe('memory reset');
      expect(attrs()[SemanticConvention.GEN_AI_OPERATION]).toBe(SemanticConvention.GEN_AI_OPERATION_TYPE_MEMORY);
    });
  });

  describe('Content capture toggle', () => {
    it('omits input/output content when captureMessageContent is false', async () => {
      (OpenlitConfig as any).captureMessageContent = false;
      await runOp('memory add', async () => ({ results: [] }), [
        [{ role: 'user', content: 'secret' }],
        {},
      ]);
      const keys = (mockSpan.setAttribute as jest.Mock).mock.calls.map(([k]: [string]) => k);
      expect(keys).not.toContain(SemanticConvention.GEN_AI_INPUT_MESSAGES);
    });
  });

  describe('Error path', () => {
    it('records the exception, still ends the span, and rethrows', async () => {
      const boom = new Error('mem0 down');
      await expect(
        runOp('memory search', async () => {
          throw boom;
        }, ['q', { topK: 3 }])
      ).rejects.toThrow('mem0 down');

      expect((OpenLitHelper as any).handleException).toHaveBeenCalledWith(mockSpan, boom);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
      // Core attributes are still emitted on the error path (best-effort).
      expect(attrs()[SemanticConvention.GEN_AI_PROVIDER_NAME]).toBe('mem0');
      expect(typeof attrs()[SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION]).toBe('number');
    });
  });
});
