import { GpuMetricsCollector, CommandRunner, GpuStats } from '../gpu';
import SemanticConvention from '../../semantic-convention';

// Columns match NVIDIA_SMI_FIELDS order:
// index, uuid, name, util.gpu, util.encoder, util.decoder, temp, fan,
// mem.total, mem.used, mem.free, power.draw, enforced.power.limit, power.limit
const NVIDIA_CSV =
  '0, GPU-11111111-2222-3333-4444-555555555555, NVIDIA A100-SXM4-40GB, 87, 15, 5, 65, 30, 40960, 30000, 10960, 250.50, 400.00, 400.00\n' +
  '1, GPU-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee, NVIDIA A100-SXM4-40GB, 12, 0, 0, 40, 25, 40960, 1024, 39936, 60.25, 0, 400.00\n';

const ROCM_JSON = JSON.stringify({
  card0: {
    'GPU ID': '0x740f',
    'Unique ID': '0x123456789abcdef',
    'Card series': 'AMD Instinct MI210',
    'GPU use (%)': '42',
    'Temperature (Sensor edge) (C)': '55.0',
    'Fan speed (%)': '35',
    'VRAM Total Memory (B)': String(64 * 1024 * 1024 * 1024),
    'VRAM Total Used Memory (B)': String(16 * 1024 * 1024 * 1024),
    'Average Graphics Package Power (W)': '180.0',
    'Max Graphics Package Power (W)': '300.0',
  },
  system: { 'Driver version': '6.2' },
});

function nvidiaRunner(): CommandRunner {
  return async (cmd, args) => {
    if (cmd !== 'nvidia-smi') throw new Error(`${cmd}: command not found`);
    if (args[0] === '-L') return 'GPU 0: NVIDIA A100\nGPU 1: NVIDIA A100\n';
    return NVIDIA_CSV;
  };
}

function amdRunner(): CommandRunner {
  return async (cmd) => {
    if (cmd !== 'rocm-smi') throw new Error(`${cmd}: command not found`);
    return ROCM_JSON;
  };
}

const noGpuRunner: CommandRunner = async (cmd) => {
  throw new Error(`${cmd}: command not found`);
};

interface FakeObservation {
  gauge: unknown;
  value: number;
  attributes: Record<string, unknown>;
}

function makeFakeMeter() {
  const gauges: Array<{ name: string; token: object }> = [];
  const observations: FakeObservation[] = [];
  let callback:
    | ((result: {
        observe: (g: unknown, v: number, a: Record<string, unknown>) => void;
      }) => Promise<void>)
    | null = null;

  const meter = {
    createObservableGauge: (name: string) => {
      const token = { name };
      gauges.push({ name, token });
      return token;
    },
    addBatchObservableCallback: (cb: typeof callback) => {
      callback = cb;
    },
  };

  const runCallback = async () => {
    if (!callback) throw new Error('no callback registered');
    await callback({
      observe: (gauge, value, attributes) => observations.push({ gauge, value, attributes }),
    });
  };

  return { meter: meter as any, gauges, observations, runCallback };
}

describe('GpuMetricsCollector', () => {
  it('detects nvidia GPUs', async () => {
    expect(await new GpuMetricsCollector(nvidiaRunner()).detectGpuType()).toBe('nvidia');
  });

  it('detects amd GPUs when nvidia-smi is missing', async () => {
    expect(await new GpuMetricsCollector(amdRunner()).detectGpuType()).toBe('amd');
  });

  it('returns null when no supported GPU tooling exists', async () => {
    expect(await new GpuMetricsCollector(noGpuRunner).detectGpuType()).toBeNull();
  });

  it('setup registers all 11 gauges with Python-matching metric names', async () => {
    const { meter, gauges } = makeFakeMeter();
    const collector = new GpuMetricsCollector(nvidiaRunner());
    const gpuType = await collector.setup({
      meter,
      environment: 'staging',
      applicationName: 'my-app',
    });

    expect(gpuType).toBe('nvidia');
    expect(gauges.map((g) => g.name)).toEqual([
      'gpu.utilization',
      'gpu.enc.utilization',
      'gpu.dec.utilization',
      'gpu.temperature',
      'gpu.fan_speed',
      'gpu.memory.available',
      'gpu.memory.total',
      'gpu.memory.used',
      'gpu.memory.free',
      'gpu.power.draw',
      'gpu.power.limit',
    ]);
  });

  it('setup returns null and registers nothing without a GPU', async () => {
    const { meter, gauges } = makeFakeMeter();
    const gpuType = await new GpuMetricsCollector(noGpuRunner).setup({
      meter,
      environment: 'staging',
      applicationName: 'my-app',
    });
    expect(gpuType).toBeNull();
    expect(gauges).toHaveLength(0);
  });

  it('observes nvidia stats per GPU with Python-matching attributes', async () => {
    const { meter, observations, runCallback } = makeFakeMeter();
    const collector = new GpuMetricsCollector(nvidiaRunner());
    await collector.setup({ meter, environment: 'staging', applicationName: 'my-app' });
    await runCallback();

    // 2 GPUs x 11 metrics
    expect(observations).toHaveLength(22);

    const gpu0 = observations.filter((o) => o.attributes[SemanticConvention.GPU_INDEX] === '0');
    expect(gpu0).toHaveLength(11);
    expect(gpu0[0].attributes).toEqual({
      'telemetry.sdk.name': 'openlit',
      'service.name': 'my-app',
      [SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]: 'staging',
      [SemanticConvention.GPU_INDEX]: '0',
      [SemanticConvention.GPU_UUID]: 'GPU-11111111-2222-3333-4444-555555555555',
      [SemanticConvention.GPU_NAME]: 'NVIDIA A100-SXM4-40GB',
    });

    const valueOf = (metric: string, index: string) =>
      observations.find(
        (o) =>
          (o.gauge as { name: string }).name === metric &&
          o.attributes[SemanticConvention.GPU_INDEX] === index
      )?.value;

    expect(valueOf('gpu.utilization', '0')).toBe(87);
    expect(valueOf('gpu.enc.utilization', '0')).toBe(15);
    expect(valueOf('gpu.dec.utilization', '0')).toBe(5);
    expect(valueOf('gpu.temperature', '0')).toBe(65);
    expect(valueOf('gpu.fan_speed', '0')).toBe(30);
    expect(valueOf('gpu.memory.total', '0')).toBe(40960);
    expect(valueOf('gpu.memory.used', '0')).toBe(30000);
    expect(valueOf('gpu.memory.free', '0')).toBe(10960);
    expect(valueOf('gpu.memory.available', '0')).toBe(10960);
    expect(valueOf('gpu.power.draw', '0')).toBe(250.5);
    expect(valueOf('gpu.power.limit', '0')).toBe(400);
    expect(valueOf('gpu.utilization', '1')).toBe(12);
    // GPU 1: enforced.power.limit is 0 / N/A → fall back to power.limit
    expect(valueOf('gpu.power.limit', '1')).toBe(400);
    expect(valueOf('gpu.enc.utilization', '1')).toBe(0);
    expect(valueOf('gpu.dec.utilization', '1')).toBe(0);
  });

  it('observes amd stats from rocm-smi JSON', async () => {
    const { meter, observations, runCallback } = makeFakeMeter();
    const collector = new GpuMetricsCollector(amdRunner());
    await collector.setup({ meter, environment: 'default', applicationName: 'default' });
    await runCallback();

    expect(observations).toHaveLength(11);
    const attrs = observations[0].attributes;
    expect(attrs[SemanticConvention.GPU_INDEX]).toBe('0');
    expect(attrs[SemanticConvention.GPU_NAME]).toBe('AMD Instinct MI210');
    expect(attrs[SemanticConvention.GPU_UUID]).toBe('0x123456789abcdef');

    const valueOf = (metric: string) =>
      observations.find((o) => (o.gauge as { name: string }).name === metric)?.value;
    expect(valueOf('gpu.utilization')).toBe(42);
    expect(valueOf('gpu.enc.utilization')).toBe(0);
    expect(valueOf('gpu.dec.utilization')).toBe(0);
    expect(valueOf('gpu.temperature')).toBe(55);
    expect(valueOf('gpu.fan_speed')).toBe(35);
    expect(valueOf('gpu.memory.total')).toBe(64 * 1024);
    expect(valueOf('gpu.memory.used')).toBe(16 * 1024);
    expect(valueOf('gpu.memory.free')).toBe(48 * 1024);
    // Python AMD memory_available == total (not free)
    expect(valueOf('gpu.memory.available')).toBe(64 * 1024);
    expect(valueOf('gpu.power.draw')).toBe(180);
    expect(valueOf('gpu.power.limit')).toBe(300);
  });

  it('swallows collection errors without throwing from the callback', async () => {
    let detect = true;
    const flakyRunner: CommandRunner = async (cmd, args) => {
      if (cmd !== 'nvidia-smi') throw new Error('not found');
      if (args[0] === '-L' && detect) return 'GPU 0: NVIDIA A100';
      throw new Error('nvidia-smi crashed');
    };
    const { meter, observations, runCallback } = makeFakeMeter();
    const collector = new GpuMetricsCollector(flakyRunner);
    await collector.setup({ meter, environment: 'default', applicationName: 'default' });
    detect = false;
    await expect(runCallback()).resolves.toBeUndefined();
    expect(observations).toHaveLength(0);
  });

  it('swallows invalid AMD JSON without throwing from the callback', async () => {
    const badJsonRunner: CommandRunner = async (cmd, args) => {
      if (cmd === 'nvidia-smi') throw new Error('not found');
      if (cmd !== 'rocm-smi') throw new Error('not found');
      if (args.includes('--showid') && args.length === 2) return '{}';
      return 'not-json{';
    };
    const { meter, observations, runCallback } = makeFakeMeter();
    const collector = new GpuMetricsCollector(badJsonRunner);
    await collector.setup({ meter, environment: 'default', applicationName: 'default' });
    await expect(runCallback()).resolves.toBeUndefined();
    expect(observations).toHaveLength(0);
  });

  it('parses malformed numeric fields as 0', async () => {
    const badCsvRunner: CommandRunner = async (cmd, args) => {
      if (cmd !== 'nvidia-smi') throw new Error('not found');
      if (args[0] === '-L') return 'GPU 0: NVIDIA A100';
      return '0, GPU-uuid, NVIDIA A100, [N/A], [N/A], [N/A], 65, [N/A], 40960, 30000, 10960, [N/A], [N/A], 400.00\n';
    };
    const collector = new GpuMetricsCollector(badCsvRunner);
    const { meter, runCallback, observations } = makeFakeMeter();
    await collector.setup({ meter, environment: 'default', applicationName: 'default' });
    await runCallback();

    const valueOf = (metric: string) =>
      observations.find((o) => (o.gauge as { name: string }).name === metric)?.value;

    expect(valueOf('gpu.utilization')).toBe(0);
    expect(valueOf('gpu.enc.utilization')).toBe(0);
    expect(valueOf('gpu.dec.utilization')).toBe(0);
    expect(valueOf('gpu.power.draw')).toBe(0);
    // enforced N/A → fall back to power.limit
    expect(valueOf('gpu.power.limit')).toBe(400);
  });
});

describe('GpuStats typing', () => {
  it('exposes all metric fields', () => {
    const stats: GpuStats = {
      index: '0',
      uuid: 'u',
      name: 'n',
      utilization: 0,
      utilization_enc: 0,
      utilization_dec: 0,
      temperature: 0,
      fan_speed: 0,
      memory_available: 0,
      memory_total: 0,
      memory_used: 0,
      memory_free: 0,
      power_draw: 0,
      power_limit: 0,
    };
    expect(Object.keys(stats)).toHaveLength(14);
  });
});
