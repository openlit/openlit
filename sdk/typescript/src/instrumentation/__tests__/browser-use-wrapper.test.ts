import { SpanKind } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BrowserUseWrapper from '../browser-use/wrapper';

jest.mock('../../config');
jest.mock('../../helpers', () => ({
  __esModule: true,
  default: { handleException: jest.fn() },
  applyCustomSpanAttributes: jest.fn(),
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function attrs(): Record<string, any> {
    return Object.fromEntries((mockSpan.setAttribute as jest.Mock).mock.calls);
  }

  it('wraps Agent.run into an invoke_agent span with browser-use metadata', async () => {
    class StubAgent {
      name = 'shopping-bot';
      task = 'Buy the cheapest laptop under $1000';
      task_id = 'task-123';
      llm = { model: 'gpt-4o-mini' };

      async run() {
        return { ok: true };
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

    const a = attrs();
    expect(a[ATTR_TELEMETRY_SDK_NAME]).toBe('openlit');
    expect(a[ATTR_SERVICE_NAME]).toBe('openlit-test');
    expect(a[SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]).toBe('openlit-testing');
    expect(a[SemanticConvention.GEN_AI_PROVIDER_NAME]).toBe('browser_use');
    expect(a[SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]).toBe('browser_use');
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('invoke_agent');
    expect(a[SemanticConvention.GEN_AI_SDK_VERSION]).toBe('0.7.3');
    expect(a[SemanticConvention.SERVER_ADDRESS]).toBe('browser-use.com');
    expect(a[SemanticConvention.SERVER_PORT]).toBe(443);
    expect(a[SemanticConvention.GEN_AI_AGENT_NAME]).toBe('shopping-bot');
    expect(a[SemanticConvention.GEN_AI_AGENT_ID]).toBe('task-123');
    expect(a[SemanticConvention.GEN_AI_AGENT_DESCRIPTION]).toBe(
      'Buy the cheapest laptop under $1000'
    );
    expect(a[SemanticConvention.GEN_AI_REQUEST_MODEL]).toBe('gpt-4o-mini');
    expect(a[SemanticConvention.GEN_AI_INPUT_MESSAGES]).toBe(
      JSON.stringify([
        {
          role: 'user',
          parts: [{ type: 'text', content: 'Buy the cheapest laptop under $1000' }],
        },
      ])
    );
    expect(typeof a[SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION]).toBe('number');
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('wraps Controller.act into an execute_tool span and captures args/results', async () => {
    class StubController {
      registry = {
        get_action: () => ({ description: 'Click element by index.' }),
      };

      async act(action: Record<string, unknown>) {
        return { extracted_content: `done:${Object.keys(action)[0]}` };
      }
    }

    const controller = new StubController();
    const wrapped = BrowserUseWrapper._patchControllerAct(mockTracer, '0.7.3')(
      StubController.prototype.act
    );
    await wrapped.call(controller, { click: { index: 4 } }, {});

    expect(mockTracer.startSpan).toHaveBeenCalledWith('execute_tool click', {
      kind: SpanKind.INTERNAL,
      attributes: {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]:
          SemanticConvention.GEN_AI_SYSTEM_BROWSER_USE,
      },
    });

    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('execute_tool');
    expect(a[SemanticConvention.GEN_AI_TOOL_NAME]).toBe('click');
    expect(a[SemanticConvention.GEN_AI_TOOL_TYPE_OTEL]).toBe('browser_action');
    expect(a[SemanticConvention.GEN_AI_TOOL_DESCRIPTION]).toBe('Click element by index.');
    expect(a[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS]).toBe('{"index":4}');
    expect(a[SemanticConvention.GEN_AI_TOOL_CALL_RESULT]).toBe(
      '{"extracted_content":"done:click"}'
    );
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('records controller errors and still ends the execute_tool span', async () => {
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
      StubController.prototype.act
    );

    await expect(wrapped.call(controller, { go_to_url: { url: 'https://example.com' } }, {})).rejects.toThrow(
      'navigation failed'
    );

    expect((OpenLitHelper as any).handleException).toHaveBeenCalledWith(
      mockSpan,
      expect.objectContaining({ message: 'navigation failed' })
    );
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });
});
