import { SpanKind } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import AgnoWrapper from '../agno/wrapper';

jest.mock('../../config');
jest.mock('../../helpers', () => ({
  __esModule: true,
  default: { handleException: jest.fn() },
  applyCustomSpanAttributes: jest.fn(),
}));

describe('AgnoWrapper', () => {
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
      spanContext: jest.fn(() => ({ traceId: 'abc', spanId: 'def', traceFlags: 1 })),
    };
    mockTracer = { startSpan: jest.fn(() => mockSpan) };

    (OpenlitConfig as any).environment = 'test';
    (OpenlitConfig as any).applicationName = 'agno-test';
    (OpenlitConfig as any).captureMessageContent = false;
  });

  afterEach(() => jest.clearAllMocks());

  function attrs(span = mockSpan): Record<string, any> {
    return Object.fromEntries((span.setAttribute as jest.Mock).mock.calls);
  }

  describe('patchAgentRun', () => {
    it('emits invoke_agent span with correct provider and operation attributes', async () => {
      class StubAgent {
        name = 'my-agent';
        async run() { return { content: 'hello' }; }
      }
      const agent = new StubAgent();
      const wrapped = AgnoWrapper.patchAgentRun(mockTracer)(StubAgent.prototype.run);
      await wrapped.call(agent, 'test input');

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        expect.stringContaining('invoke_agent'),
        expect.objectContaining({
          kind: SpanKind.CLIENT,
          attributes: expect.objectContaining({
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_AGNO,
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
          }),
        }),
      );

      const a = attrs();
      expect(a[ATTR_TELEMETRY_SDK_NAME]).toBe('openlit');
      expect(a[ATTR_SERVICE_NAME]).toBe('agno-test');
      expect(a[SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]).toBe('test');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
      // create_agent + invoke_agent both use mockSpan, so end() is called twice
      expect(mockSpan.end).toHaveBeenCalledTimes(2);
    });

    it('emits create_agent span on first run call for a new agent', async () => {
      const createSpan = { setAttribute: jest.fn(), setStatus: jest.fn(), end: jest.fn(), spanContext: jest.fn(() => ({ traceId: 'x', spanId: 'y', traceFlags: 1 })) };
      const invokeSpan = { setAttribute: jest.fn(), setStatus: jest.fn(), end: jest.fn(), spanContext: jest.fn() };
      mockTracer.startSpan = jest.fn((name: string) =>
        name.startsWith('create_agent') ? createSpan : invokeSpan,
      );

      class StubAgent {
        name = 'fresh-agent';
        async run() { return {}; }
      }
      const agent = new StubAgent();
      const wrapped = AgnoWrapper.patchAgentRun(mockTracer)(StubAgent.prototype.run);
      await wrapped.call(agent, 'hi');

      const spanNames = (mockTracer.startSpan as jest.Mock).mock.calls.map((c: any[]) => c[0]);
      expect(spanNames.some((n: string) => n.startsWith('create_agent'))).toBe(true);
      expect(createSpan.end).toHaveBeenCalledTimes(1);
    });

    it('calls handleException and rethrows on error', async () => {
      class StubAgent {
        name = 'err-agent';
        async run() { throw new Error('agent failed'); }
      }
      const agent = new StubAgent();
      const wrapped = AgnoWrapper.patchAgentRun(mockTracer)(StubAgent.prototype.run);

      await expect(wrapped.call(agent)).rejects.toThrow('agent failed');
      expect(OpenLitHelper.handleException).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: 'agent failed' }),
      );
      // create_agent span end() + invoke_agent span end() (in finally)
      expect(mockSpan.end).toHaveBeenCalledTimes(2);
    });
  });

  describe('patchTeamRun', () => {
    it('emits invoke_workflow span with correct attributes', async () => {
      class StubTeam {
        name = 'my-team';
        async run() { return {}; }
      }
      const team = new StubTeam();
      const wrapped = AgnoWrapper.patchTeamRun(mockTracer)(StubTeam.prototype.run);
      await wrapped.call(team);

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'invoke_workflow my-team',
        expect.objectContaining({ kind: SpanKind.INTERNAL }),
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('patchToolExecute', () => {
    it('emits execute_tool span with correct attributes', async () => {
      class StubFunctionCall {
        function = { name: 'search_web' };
        async execute() { return 'result'; }
      }
      const fc = new StubFunctionCall();
      const wrapped = AgnoWrapper.patchToolExecute(mockTracer)(StubFunctionCall.prototype.execute);
      await wrapped.call(fc);

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'execute_tool search_web',
        expect.objectContaining({
          kind: SpanKind.INTERNAL,
          attributes: expect.objectContaining({
            [SemanticConvention.GEN_AI_TOOL_NAME]: 'search_web',
          }),
        }),
      );
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });
});
