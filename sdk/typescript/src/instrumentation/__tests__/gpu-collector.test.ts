import {
  parseNumber,
  parseNvidiaSmiCsv,
  isNvidiaSmiAvailable,
  queryNvidiaSmi,
  NVIDIA_SMI_FIELDS,
  ExecFileLike,
} from '../gpu/collector';
import { setupGpuInstrumentation } from '../gpu';
import SemanticConvention from '../../semantic-convention';

// A realistic two-GPU `nvidia-smi --format=csv,noheader,nounits` payload.
// Field order matches NVIDIA_SMI_FIELDS.
const SAMPLE_CSV = [
  '0, GPU-aaaaaaaa-1111, NVIDIA A100-SXM4-40GB, 45, 3, 1, 62, 30, 12000, 40536, 28536, 250.35, 400.00',
  '1, GPU-bbbbbbbb-2222, NVIDIA A100-SXM4-40GB, 0, 0, 0, 40, 0, 40000, 40536, 536, 55.10, 400.00',
].join('\n');

describe('gpu/collector parseNumber', () => {
  it('parses numeric strings', () => {
    expect(parseNumber('45')).toBe(45);
    expect(parseNumber(' 250.35 ')).toBeCloseTo(250.35);
  });

  it('coerces non-numeric / unsupported values to 0', () => {
    expect(parseNumber('[N/A]')).toBe(0);
    expect(parseNumber('[Not Supported]')).toBe(0);
    expect(parseNumber('')).toBe(0);
  });
});

describe('gpu/collector parseNvidiaSmiCsv', () => {
  it('parses one row per GPU with correct field mapping', () => {
    const rows = parseNvidiaSmiCsv(SAMPLE_CSV);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toEqual({
      index: '0',
      uuid: 'GPU-aaaaaaaa-1111',
      name: 'NVIDIA A100-SXM4-40GB',
      utilization: 45,
      utilizationEnc: 3,
      utilizationDec: 1,
      temperature: 62,
      fanSpeed: 30,
      memoryFree: 12000,
      memoryTotal: 40536,
      memoryUsed: 28536,
      powerDraw: 250.35,
      powerLimit: 400,
    });
    expect(rows[1].index).toBe('1');
    expect(rows[1].utilization).toBe(0);
    expect(rows[1].powerDraw).toBeCloseTo(55.1);
  });

  it('ignores blank lines and malformed rows', () => {
    const raw = `\n${SAMPLE_CSV}\n\ntoo, few, cols\n`;
    expect(parseNvidiaSmiCsv(raw)).toHaveLength(2);
  });

  it('reconstructs GPU names that contain commas', () => {
    const raw = '0, GPU-xyz, Fancy GPU, Turbo Edition, 10, 0, 0, 50, 0, 100, 200, 100, 30, 60';
    const rows = parseNvidiaSmiCsv(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Fancy GPU, Turbo Edition');
    expect(rows[0].utilization).toBe(10);
    expect(rows[0].powerLimit).toBe(60);
  });

  it('maps unsupported metric cells to 0', () => {
    const raw = '0, GPU-zzz, NVIDIA T4, [N/A], [Not Supported], 0, 55, [N/A], 8000, 16000, 8000, 40, 70';
    const rows = parseNvidiaSmiCsv(raw);
    expect(rows[0].utilization).toBe(0);
    expect(rows[0].utilizationEnc).toBe(0);
    expect(rows[0].fanSpeed).toBe(0);
    expect(rows[0].temperature).toBe(55);
  });
});

describe('gpu/collector isNvidiaSmiAvailable', () => {
  it('resolves true when nvidia-smi -L lists a GPU', async () => {
    const fakeExec: ExecFileLike = (_file, _args, _opts, cb) =>
      cb(null, 'GPU 0: NVIDIA A100 (UUID: GPU-aaaa)\n', '');
    await expect(isNvidiaSmiAvailable(fakeExec)).resolves.toBe(true);
  });

  it('resolves false when nvidia-smi errors (non-GPU host)', async () => {
    const fakeExec: ExecFileLike = (_file, _args, _opts, cb) =>
      cb(new Error('command not found'), '', '');
    await expect(isNvidiaSmiAvailable(fakeExec)).resolves.toBe(false);
  });

  it('resolves false when nvidia-smi returns empty output', async () => {
    const fakeExec: ExecFileLike = (_file, _args, _opts, cb) => cb(null, '   \n', '');
    await expect(isNvidiaSmiAvailable(fakeExec)).resolves.toBe(false);
  });
});

describe('gpu/collector queryNvidiaSmi', () => {
  it('queries all fields and returns parsed rows', async () => {
    let requestedArgs: string[] = [];
    const fakeExec: ExecFileLike = (_file, args, _opts, cb) => {
      requestedArgs = args;
      cb(null, SAMPLE_CSV, '');
    };
    const rows = await queryNvidiaSmi(fakeExec);
    expect(rows).toHaveLength(2);
    expect(requestedArgs[0]).toBe(`--query-gpu=${NVIDIA_SMI_FIELDS.join(',')}`);
    expect(requestedArgs).toContain('--format=csv,noheader,nounits');
  });

  it('resolves to [] on error instead of throwing', async () => {
    const fakeExec: ExecFileLike = (_file, _args, _opts, cb) => cb(new Error('boom'), '', '');
    await expect(queryNvidiaSmi(fakeExec)).resolves.toEqual([]);
  });
});

// Minimal fake meter capturing observable-gauge registration + the batch callback.
function makeFakeMeter() {
  const gauges: Array<{ name: string; description?: string }> = [];
  let batchCallback: ((result: any) => unknown) | undefined;
  const meter = {
    createObservableGauge(name: string, opts?: { description?: string }) {
      const g = { name, description: opts?.description };
      gauges.push(g);
      return g as any;
    },
    addBatchObservableCallback(cb: (result: any) => unknown, _observables: unknown[]) {
      batchCallback = cb;
    },
  };
  return { meter, gauges, runBatch: () => batchCallback };
}

describe('setupGpuInstrumentation', () => {
  it('no-ops and returns false when no GPU is detected', async () => {
    const { meter, gauges } = makeFakeMeter();
    const ok = await setupGpuInstrumentation({
      meter: meter as any,
      environment: 'test',
      applicationName: 'app',
      detectFn: async () => false,
      queryFn: async () => [],
    });
    expect(ok).toBe(false);
    expect(gauges).toHaveLength(0);
  });

  it('registers 11 gauges and observes every metric per GPU', async () => {
    const { meter, gauges, runBatch } = makeFakeMeter();
    const ok = await setupGpuInstrumentation({
      meter: meter as any,
      environment: 'prod',
      applicationName: 'inference-svc',
      detectFn: async () => true,
      queryFn: async () => parseNvidiaSmiCsv(SAMPLE_CSV),
    });
    expect(ok).toBe(true);
    expect(gauges).toHaveLength(11);
    expect(gauges.map((g) => g.name)).toContain(SemanticConvention.GPU_UTILIZATION);
    expect(gauges.map((g) => g.name)).toContain(SemanticConvention.GPU_POWER_LIMIT);

    // Drive the batch callback and capture observations.
    const observations: Array<{ gauge: any; value: number; attrs: any }> = [];
    const result = {
      observe: (gauge: any, value: number, attrs: any) =>
        observations.push({ gauge, value, attrs }),
    };
    await runBatch()!(result);

    // 11 gauges x 2 GPUs = 22 observations.
    expect(observations).toHaveLength(22);

    // Spot-check GPU 0 utilization observation + its attributes.
    const utilGauge = gauges.find((g) => g.name === SemanticConvention.GPU_UTILIZATION);
    const gpu0Util = observations.find(
      (o) => o.gauge === utilGauge && o.attrs[SemanticConvention.GPU_INDEX] === '0'
    );
    expect(gpu0Util?.value).toBe(45);
    expect(gpu0Util?.attrs[SemanticConvention.GPU_NAME]).toBe('NVIDIA A100-SXM4-40GB');
    expect(gpu0Util?.attrs[SemanticConvention.GPU_UUID]).toBe('GPU-aaaaaaaa-1111');
    expect(gpu0Util?.attrs['telemetry.sdk.name']).toBe('openlit');
    expect(gpu0Util?.attrs['service.name']).toBe('inference-svc');

    // gpu.memory.available maps to free memory (parity with Python).
    const availGauge = gauges.find((g) => g.name === SemanticConvention.GPU_MEMORY_AVAILABLE);
    const gpu0Avail = observations.find(
      (o) => o.gauge === availGauge && o.attrs[SemanticConvention.GPU_INDEX] === '0'
    );
    expect(gpu0Avail?.value).toBe(12000);
  });

  it('swallows query errors during a collection tick without throwing', async () => {
    const { meter, runBatch } = makeFakeMeter();
    await setupGpuInstrumentation({
      meter: meter as any,
      environment: 'prod',
      applicationName: 'app',
      detectFn: async () => true,
      queryFn: async () => {
        throw new Error('nvidia-smi vanished');
      },
    });
    const observations: unknown[] = [];
    const result = { observe: () => observations.push(1) };
    await expect(runBatch()!(result)).resolves.not.toThrow();
    expect(observations).toHaveLength(0);
  });
});
