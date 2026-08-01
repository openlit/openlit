import { SpanKind } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import AgentFrameworkWrapper from '../agent-framework/wrapper';

jest.mock('../../config');
jest.mock('../../helpers', () => ({
  __esModule: true,
  default: { handleException: jest.fn() },
  applyCustomSpanAttributes: jest.fn(),
}));

describe('AgentFrameworkWrapper', () => {
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
    (OpenlitConfig as any).applicationName = 'af-test';
    (OpenlitConfig as any).captureMessageContent = false;
  });

  afterEach(() => jest.clearAllMocks());

  function attrs(span = mockSpan): Record<string, any> {
    return Object.fromEntries((span.setAttribute as jest.Mock).mock.calls);
  }

  describe('patchAgentRun', () => {
    it('emits invoke_agent span with correct provider attribute', async () => {
      class StubAgent {
        name = 'my-af-agent';
        async run() { return { result: 'done' }; }
      }
      const agent = new StubAgent();
      const wrapped = AgentFrameworkWrapper.patchAgentRun(mockTracer)(StubAgent.prototype.run);
      await wrapped.call(agent, 'hello');

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        expect.stringContaining('invoke_agent'),
        expect.objectContaining({
          kind: SpanKind.CLIENT,
          attributes: expect.objectContaining({
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_AGENT_FRAMEWORK,
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
          }),
        }),
      );

      const a = attrs();
      expect(a[ATTR_TELEMETRY_SDK_NAME]).toBe('openlit');
      expect(a[ATTR_SERVICE_NAME]).toBe('af-test');
      expect(a[SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]).toBe('test');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
      // create_agent + invoke_agent both use mockSpan, so end() is called twice
      expect(mockSpan.end).toHaveBeenCalledTimes(2);
    });

    it('emits create_agent span on first run call', async () => {
      const createSpan = { setAttribute: jest.fn(), setStatus: jest.fn(), end: jest.fn(), spanContext: jest.fn(() => ({ traceId: 'x', spanId: 'y', traceFlags: 1 })) };
      const invokeSpan = { setAttribute: jest.fn(), setStatus: jest.fn(), end: jest.fn(), spanContext: jest.fn() };
      mockTracer.startSpan = jest.fn((name: string) =>
        name.startsWith('create_agent') ? createSpan : invokeSpan,
      );

      class StubAgent {
        name = 'fresh-af-agent';
        async run() { return {}; }
      }
      const agent = new StubAgent();
      const wrapped = AgentFrameworkWrapper.patchAgentRun(mockTracer)(StubAgent.prototype.run);
      await wrapped.call(agent, 'hi');

      const spanNames = (mockTracer.startSpan as jest.Mock).mock.calls.map((c: any[]) => c[0]);
      expect(spanNames.some((n: string) => n.startsWith('create_agent'))).toBe(true);
      expect(createSpan.end).toHaveBeenCalledTimes(1);
    });

    it('calls handleException and rethrows on error', async () => {
      class StubAgent {
        name = 'err-af-agent';
        async run() { throw new Error('af agent failed'); }
      }
      const agent = new StubAgent();
      const wrapped = AgentFrameworkWrapper.patchAgentRun(mockTracer)(StubAgent.prototype.run);

      await expect(wrapped.call(agent)).rejects.toThrow('af agent failed');
      expect(OpenLitHelper.handleException).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: 'af agent failed' }),
      );
      // create_agent span end() + invoke_agent span end() (in finally)
      expect(mockSpan.end).toHaveBeenCalledTimes(2);
    });
  });

  describe('patchToolInvoke', () => {
    it('emits execute_tool span with correct attributes', async () => {
      class StubFunctionTool {
        name = 'get_weather';
        async invoke() { return 'sunny'; }
      }
      const tool = new StubFunctionTool();
      const wrapped = AgentFrameworkWrapper.patchToolInvoke(mockTracer)(StubFunctionTool.prototype.invoke);
      await wrapped.call(tool);

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'execute_tool get_weather',
        expect.objectContaining({
          kind: SpanKind.INTERNAL,
          attributes: expect.objectContaining({
            [SemanticConvention.GEN_AI_TOOL_NAME]: 'get_weather',
          }),
        }),
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('patchWorkflowRun', () => {
    it('emits invoke_workflow span with correct attributes', async () => {
      class StubWorkflow {
        name = 'my-workflow';
        async run() { return {}; }
      }
      const wf = new StubWorkflow();
      const wrapped = AgentFrameworkWrapper.patchWorkflowRun(mockTracer)(StubWorkflow.prototype.run);
      await wrapped.call(wf);

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'invoke_workflow my-workflow',
        expect.objectContaining({ kind: SpanKind.INTERNAL }),
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });
});
