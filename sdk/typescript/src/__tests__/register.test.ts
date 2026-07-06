describe('openlit/register', () => {
  const originalEnv = process.env;
  const originalVersion = process.versions.node;
  let initMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    initMock = jest.fn();
    jest.doMock('../index', () => ({
      __esModule: true,
      default: { init: initMock },
    }));
    process.env = {
      ...originalEnv,
      OTEL_SERVICE_NAME: 'node-ai-app',
      OTEL_DEPLOYMENT_ENVIRONMENT: 'prod',
      OTEL_RESOURCE_ATTRIBUTES: 'service.workload.key=k8s:demo,team=ai',
      OPENLIT_DISABLED_INSTRUMENTORS: 'openai,anthropic',
    };
    delete (globalThis as any).__openlit_register_initialized__;
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process.versions, 'node', {
      value: originalVersion,
      configurable: true,
    });
    delete (globalThis as any).__openlit_register_initialized__;
    jest.dontMock('../index');
  });

  it('initializes once with controller environment values', async () => {
    await import('../register');
    await import('../register');

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock).toHaveBeenCalledWith({
      applicationName: 'node-ai-app',
      environment: 'prod',
      disabledInstrumentors: ['openai', 'anthropic'],
      customSpanAttributes: {
        'service.workload.key': 'k8s:demo',
        team: 'ai',
      },
    });
  });

  it('skips unsupported Node.js versions', async () => {
    Object.defineProperty(process.versions, 'node', {
      value: '16.20.2',
      configurable: true,
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await import('../register');

    expect(initMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('requires Node.js 18 or newer')
    );
    errorSpy.mockRestore();
  });
});

