import { SpanKind } from '@opentelemetry/api';
import { isTracingSuppressed } from '@opentelemetry/core';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BrowserUseWrapper from '../browser-use/wrapper';
import BrowserUseInstrumentation from '../browser-use';

jest.mock('../../config');
jest.mock('../../helpers', () => ({
  __esModule: true,
  default: {
    handleException: jest.fn(),
    getChatModelCost: jest.fn().mockReturnValue(0.0025),
  },
  applyCustomSpanAttributes: jest.fn(),
}));
jest.mock('@opentelemetry/core', () => ({
  isTracingSuppressed: jest.fn().mockReturnValue(false),
}));

describe('browser-use wrapper', () => {
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
    };
    mockTracer = { startSpan: jest.fn(() => mockSpan) };

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
    (OpenlitConfig as any).maxContentLength = null;
    (OpenlitConfig as any).pricingInfo = {
      chat: { 'gpt-4o-mini': { promptPrice: 0.15, completionPrice: 0.6 } },
    };
    (isTracingSuppressed as jest.Mock).mockReturnValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function attrs(): Record<string, any> {
    return Object.fromEntries((mockSpan.setAttribute as jest.Mock).mock.calls);
  }

  it('wraps Agent.run into an invoke_agent span with browser-use metadata', async () => {
    const mainSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
    };
    mockTracer.startSpan = jest.fn((name: string) => {
      if (name === 'invoke_agent shopping-bot') {
        return mainSpan;
      }
      return {
        setAttribute: jest.fn(),
        setStatus: jest.fn(),
        end: jest.fn(),
      };
    });

    class StubAgent {
      name = 'shopping-bot';
      task = 'Buy the cheapest laptop under $1000';
      id = 'agent-1';
      task_id = 'task-123';
      session_id = 'session-456';
      llm = { model: 'gpt-4o-mini' };
      use_vision = true;
      browser_profile = { headless: true, allowed_domains: ['example.com'] };

      async run() {
        return {
          history: [{ result: [{ is_success: true }] }],
          usage: { total_input_tokens: 10, total_output_tokens: 5 },
          final_result: () => 'done',
          total_duration_seconds: () => 1.5,
        };
      }
    }

    const agent = new StubAgent();
    const wrapped = BrowserUseWrapper._patchAgentRun(mockTracer, '0.7.3')(StubAgent.prototype.run);
    await wrapped.call(agent, 10);

    expect(mockTracer.startSpan).toHaveBeenCalledWith('invoke_agent shopping-bot', {
      kind: SpanKind.CLIENT,
      attributes: {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]:
          SemanticConvention.GEN_AI_SYSTEM_BROWSER_USE,
      },
    });

    const a = Object.fromEntries((mainSpan.setAttribute as jest.Mock).mock.calls);
    expect(a[ATTR_TELEMETRY_SDK_NAME]).toBe('openlit');
    expect(a[ATTR_SERVICE_NAME]).toBe('openlit-test');
    expect(a[SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]).toBe('openlit-testing');
    expect(a[SemanticConvention.GEN_AI_PROVIDER_NAME]).toBe('browser_use');
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('invoke_agent');
    expect(a[SemanticConvention.GEN_AI_OPERATION_TYPE]).toBe('invoke_agent');
    expect(a[SemanticConvention.GEN_AI_AGENT_TYPE]).toBe('browser');
    expect(a[SemanticConvention.GEN_AI_AGENT_ID]).toBe('agent-1');
    expect(a[SemanticConvention.GEN_AI_BROWSER_AGENT_TASK_ID]).toBe('task-123');
    expect(a[SemanticConvention.GEN_AI_AGENT_SESSION_ID]).toBe('session-456');
    expect(a[SemanticConvention.GEN_AI_AGENT_USE_VISION]).toBe(true);
    expect(a[SemanticConvention.GEN_AI_AGENT_HEADLESS]).toBe(true);
    expect(a[SemanticConvention.GEN_AI_AGENT_MAX_STEPS]).toBe(10);
    expect(a[SemanticConvention.GEN_AI_AGENT_STEP_COUNT]).toBe(1);
    expect(a[SemanticConvention.GEN_AI_AGENT_FINAL_RESULT]).toBe('done');
    expect(a[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]).toBe(10);
    expect(a[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(5);
    expect(typeof a[SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION]).toBe('number');
    expect(mainSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
    expect(mainSpan.end).toHaveBeenCalledTimes(1);
  });

  it('records Agent.run errors and still ends the span', async () => {
    class StubAgent {
      task = 'fail task';

      async run() {
        throw new Error('agent run failed');
      }
    }

    const agent = new StubAgent();
    const wrapped = BrowserUseWrapper._patchAgentRun(mockTracer, '0.7.3')(StubAgent.prototype.run);

    await expect(wrapped.call(agent)).rejects.toThrow('agent run failed');
    expect(OpenLitHelper.handleException).toHaveBeenCalledWith(
      mockSpan,
      expect.objectContaining({ message: 'agent run failed' }),
    );
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('bypasses instrumentation when tracing is suppressed', async () => {
    (isTracingSuppressed as jest.Mock).mockReturnValue(true);
    const original = jest.fn().mockResolvedValue({ ok: true });
    const wrapped = BrowserUseWrapper._patchAgentRun(mockTracer, '0.7.3')(original);

    await wrapped.call({ task: 'x' });
    expect(original).toHaveBeenCalled();
    expect(mockTracer.startSpan).not.toHaveBeenCalled();
  });

  it('wraps Controller.act into invoke_agent action spans (Python parity)', async () => {
    class StubController {
      registry = {
        get_action: () => ({ description: 'Click element by index.' }),
      };

      async act(action: Record<string, unknown>) {
        return { is_success: true, extracted_content: `done:${Object.keys(action)[0]}` };
      }
    }

    const controller = new StubController();
    const wrapped = BrowserUseWrapper._patchControllerAct(mockTracer, '0.7.3')(
      StubController.prototype.act,
    );
    await wrapped.call(controller, { go_to_url: { url: 'https://example.com/page' } }, {});

    expect(mockTracer.startSpan).toHaveBeenCalledWith('invoke_agent go_to_url', {
      kind: SpanKind.INTERNAL,
      attributes: {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]:
          SemanticConvention.GEN_AI_SYSTEM_BROWSER_USE,
      },
    });

    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('invoke_agent');
    expect(a[SemanticConvention.GEN_AI_OPERATION_TYPE]).toBe('execute_task');
    expect(a[SemanticConvention.GEN_AI_ACTION_TYPE]).toBe('go_to_url');
    expect(a[SemanticConvention.GEN_AI_ACTION_INDEX]).toBe(1);
    expect(a['gen_ai.action.url']).toBe('https://example.com/page');
    expect(a[SemanticConvention.GEN_AI_ACTION_SUCCESS]).toBe(true);
    expect(a[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS]).toBe(
      '{"url":"https://example.com/page"}',
    );
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('records controller errors and still ends the action span', async () => {
    class StubController {
      registry = {
        get_action: () => ({ description: 'Navigate to URL.' }),
      };

      async act() {
        throw new Error('navigation failed');
      }
    }

    const controller = new StubController();
    const wrapped = BrowserUseWrapper._patchControllerAct(mockTracer, '0.7.3')(
      StubController.prototype.act,
    );

    await expect(
      wrapped.call(controller, { go_to_url: { url: 'https://example.com' } }, {}),
    ).rejects.toThrow('navigation failed');

    expect(OpenLitHelper.handleException).toHaveBeenCalledWith(
      mockSpan,
      expect.objectContaining({ message: 'navigation failed' }),
    );
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('wraps Agent.step into execute_task spans', async () => {
    class StubAgent {
      name = 'research-bot';
      step_count = 2;
      llm = { model: 'gpt-4o' };

      async step() {
        return { is_success: true };
      }
    }

    const agent = new StubAgent();
    const wrapped = BrowserUseWrapper._patchAgentStep(mockTracer, '0.7.3')(StubAgent.prototype.step);
    await wrapped.call(agent);

    expect(mockTracer.startSpan).toHaveBeenCalledWith('execute_task step 2', { kind: SpanKind.CLIENT });
    expect(attrs()[SemanticConvention.GEN_AI_OPERATION]).toBe('step');
    expect(attrs()[SemanticConvention.GEN_AI_OPERATION_TYPE]).toBe('execute_task');
  });

  it('wraps Agent.pause into browser lifecycle spans', async () => {
    class StubAgent {
      name = 'research-bot';

      async pause() {
        return undefined;
      }
    }

    const agent = new StubAgent();
    const wrapped = BrowserUseWrapper._patchAgentLifecycle(mockTracer, 'pause', '0.7.3')(
      StubAgent.prototype.pause,
    );
    await wrapped.call(agent);

    expect(mockTracer.startSpan).toHaveBeenCalledWith('browser pause', { kind: SpanKind.CLIENT });
    expect(attrs()[SemanticConvention.GEN_AI_OPERATION]).toBe('pause');
    expect(attrs()[SemanticConvention.GEN_AI_OPERATION_TYPE]).toBe('invoke_workflow');
  });

  it('creates step and action spans from run history when step hooks do not fire', async () => {
    class StubAgent {
      name = 'history-bot';
      task = 'complete checkout';

      async run(_options?: Record<string, unknown>) {
        return {
          history: [
            {
              model_output: { action: [{ click: { index: 1 } }] },
              result: [{ is_success: true }],
              state: { url: 'https://shop.example/cart', title: 'Cart' },
            },
          ],
          usage: { total_input_tokens: 3, total_output_tokens: 2 },
          final_result: () => 'checked out',
        };
      }
    }

    const agent = new StubAgent();
    const wrapped = BrowserUseWrapper._patchAgentRun(mockTracer, '0.7.3')(StubAgent.prototype.run);
    await wrapped.call(agent);

    const spanNames = (mockTracer.startSpan as jest.Mock).mock.calls.map((call: any[]) => call[0]);
    expect(spanNames).toContain('invoke_agent history-bot');
    expect(spanNames).toContain('execute_task step 1');
    expect(spanNames).toContain('invoke_agent click');
  });
});

describe('BrowserUseInstrumentation patch targets', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isWrapped } = require('@opentelemetry/instrumentation');

  it('wraps Agent lifecycle methods and Controller.act', () => {
    class Agent {
      async run() {
        return null;
      }
      async step() {
        return null;
      }
      async pause() {}
      async resume() {}
      async stop() {}
    }

    class Controller {
      async act() {
        return null;
      }
    }

    const fakeModule = { Agent, Controller } as any;
    const instrumentation = new BrowserUseInstrumentation();
    instrumentation.manualPatch(fakeModule, '0.7.3');

    expect(isWrapped(fakeModule.Agent.prototype.run)).toBe(true);
    expect(isWrapped(fakeModule.Agent.prototype.step)).toBe(true);
    expect(isWrapped(fakeModule.Agent.prototype.pause)).toBe(true);
    expect(isWrapped(fakeModule.Agent.prototype.resume)).toBe(true);
    expect(isWrapped(fakeModule.Agent.prototype.stop)).toBe(true);
    expect(isWrapped(fakeModule.Controller.prototype.act)).toBe(true);
  });
});
