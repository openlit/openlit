import Openlit from '../../index';
import Events from '../events';
import Metrics from '../metrics';
import Tracing from '../tracing';

describe('flush and shutdown', () => {
  afterEach(() => jest.restoreAllMocks());

  const spyAll = (method: 'forceFlush' | 'shutdown') => [
    jest.spyOn(Tracing, method).mockResolvedValue(undefined),
    jest.spyOn(Events, method).mockResolvedValue(undefined),
    jest.spyOn(Metrics, method).mockResolvedValue(undefined),
  ];

  it('flush covers traces, events and metrics', async () => {
    const spies = spyAll('forceFlush');

    await Openlit.flush();

    spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
  });

  it('shutdown covers traces, events and metrics', async () => {
    const spies = spyAll('shutdown');

    await Openlit.shutdown();

    spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
  });

  it('never rejects: a telemetry failure must not fail the request', async () => {
    const [traces] = spyAll('forceFlush');
    traces.mockRejectedValue(new Error('collector down'));

    await expect(Openlit.flush()).resolves.toBeUndefined();
  });

  it('is safe before init', async () => {
    await expect(Openlit.flush()).resolves.toBeUndefined();
    await expect(Openlit.shutdown()).resolves.toBeUndefined();
  });
});
