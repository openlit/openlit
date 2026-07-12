/**
 * GPU metrics collection for Node.js services, mirroring the Python SDK's
 * `gpu` instrumentor (sdk/python/src/openlit/instrumentation/gpu/).
 *
 * Instead of NVML/AMD-SMI native bindings, this collector shells out to the
 * vendor CLI tools that ship with the drivers:
 *   - NVIDIA: `nvidia-smi --query-gpu=... --format=csv,noheader,nounits`
 *   - AMD:    `rocm-smi --json` with the relevant --show* flags
 *
 * Metric names and attributes match the Python SDK exactly so dashboards
 * stay shared across languages.
 */
import { execFile } from 'child_process';
import { diag } from '@opentelemetry/api';
import type { BatchObservableResult, ObservableGauge } from '@opentelemetry/api';
import SemanticConvention from '../../semantic-convention';
import { SDK_NAME } from '../../constant';
import type { MeterType } from '../../types';

export type GpuType = 'nvidia' | 'amd';

export interface GpuStats {
  index: string;
  uuid: string;
  name: string;
  utilization: number;
  utilization_enc: number;
  utilization_dec: number;
  temperature: number;
  fan_speed: number;
  memory_available: number;
  memory_total: number;
  memory_used: number;
  memory_free: number;
  power_draw: number;
  power_limit: number;
}

type GpuMetricKey = keyof Omit<GpuStats, 'index' | 'uuid' | 'name'>;

const GPU_METRICS: Array<{ semconv: string; key: GpuMetricKey; description: string }> = [
  { semconv: SemanticConvention.GPU_UTILIZATION, key: 'utilization', description: 'GPU Utilization' },
  { semconv: SemanticConvention.GPU_UTILIZATION_ENC, key: 'utilization_enc', description: 'GPU Utilization Enc' },
  { semconv: SemanticConvention.GPU_UTILIZATION_DEC, key: 'utilization_dec', description: 'GPU Utilization Dec' },
  { semconv: SemanticConvention.GPU_TEMPERATURE, key: 'temperature', description: 'GPU Temperature' },
  { semconv: SemanticConvention.GPU_FAN_SPEED, key: 'fan_speed', description: 'GPU Fan Speed' },
  { semconv: SemanticConvention.GPU_MEMORY_AVAILABLE, key: 'memory_available', description: 'GPU Memory Available' },
  { semconv: SemanticConvention.GPU_MEMORY_TOTAL, key: 'memory_total', description: 'GPU Memory Total' },
  { semconv: SemanticConvention.GPU_MEMORY_USED, key: 'memory_used', description: 'GPU Memory Used' },
  { semconv: SemanticConvention.GPU_MEMORY_FREE, key: 'memory_free', description: 'GPU Memory Free' },
  { semconv: SemanticConvention.GPU_POWER_DRAW, key: 'power_draw', description: 'GPU Power Draw' },
  { semconv: SemanticConvention.GPU_POWER_LIMIT, key: 'power_limit', description: 'GPU Power Limit' },
];

/**
 * Field order must stay aligned with the CSV column indices in collectNvidiaStats.
 * `enforced.power.limit` matches Python's nvmlDeviceGetEnforcedPowerLimit;
 * `power.limit` is a fallback when enforced is N/A.
 */
const NVIDIA_SMI_FIELDS = [
  'index',
  'uuid',
  'name',
  'utilization.gpu',
  'utilization.encoder',
  'utilization.decoder',
  'temperature.gpu',
  'fan.speed',
  'memory.total',
  'memory.used',
  'memory.free',
  'power.draw',
  'enforced.power.limit',
  'power.limit',
] as const;

export type CommandRunner = (cmd: string, args: string[]) => Promise<string>;

const defaultRunner: CommandRunner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10000, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

function toNumber(value: unknown): number {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

export class GpuMetricsCollector {
  private runner: CommandRunner;
  private gpuType: GpuType | null = null;

  constructor(runner: CommandRunner = defaultRunner) {
    this.runner = runner;
  }

  async detectGpuType(): Promise<GpuType | null> {
    try {
      await this.runner('nvidia-smi', ['-L']);
      return 'nvidia';
    } catch {
      /* not nvidia */
    }
    try {
      await this.runner('rocm-smi', ['--showid', '--json']);
      return 'amd';
    } catch {
      /* not amd */
    }
    return null;
  }

  async collectStats(): Promise<GpuStats[]> {
    if (this.gpuType === 'nvidia') return this.collectNvidiaStats();
    if (this.gpuType === 'amd') return this.collectAmdStats();
    return [];
  }

  private async collectNvidiaStats(): Promise<GpuStats[]> {
    const stdout = await this.runner('nvidia-smi', [
      `--query-gpu=${NVIDIA_SMI_FIELDS.join(',')}`,
      '--format=csv,noheader,nounits',
    ]);

    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split(',').map((p) => p.trim());
        const memoryFree = toNumber(parts[10]);
        // Prefer enforced power limit (Python NVML parity); fall back to power.limit.
        const powerLimit = toNumber(parts[12]) || toNumber(parts[13]);
        return {
          index: parts[0] ?? '0',
          uuid: parts[1] ?? '',
          name: parts[2] ?? '',
          utilization: toNumber(parts[3]),
          utilization_enc: toNumber(parts[4]),
          utilization_dec: toNumber(parts[5]),
          temperature: toNumber(parts[6]),
          // Python NVML path always reports 0 for NVIDIA fan_speed (many
          // datacenter cards have no fan sensor). nvidia-smi exposes the value
          // when present; [N/A] becomes 0 via toNumber, matching Python.
          fan_speed: toNumber(parts[7]),
          memory_total: toNumber(parts[8]),
          memory_used: toNumber(parts[9]),
          memory_free: memoryFree,
          // Python NVIDIA: memory_available == memory_free
          memory_available: memoryFree,
          power_draw: toNumber(parts[11]),
          power_limit: powerLimit,
        };
      });
  }

  private async collectAmdStats(): Promise<GpuStats[]> {
    const stdout = await this.runner('rocm-smi', [
      '--showid',
      '--showuniqueid',
      '--showproductname',
      '--showuse',
      '--showmeminfo',
      'vram',
      '--showtemp',
      '--showfan',
      '--showpower',
      '--json',
    ]);

    let parsed: Record<string, Record<string, unknown>>;
    try {
      parsed = JSON.parse(stdout) as Record<string, Record<string, unknown>>;
    } catch (e) {
      throw new Error(`rocm-smi returned invalid JSON: ${e}`);
    }

    const megaBytes = 1024 * 1024;

    return Object.entries(parsed)
      .filter(([card]) => card.toLowerCase().startsWith('card'))
      .map(([card, data], i) => {
        const memoryTotal = toNumber(data['VRAM Total Memory (B)']) / megaBytes;
        const memoryUsed = toNumber(data['VRAM Total Used Memory (B)']) / megaBytes;
        const memoryFree = memoryTotal - memoryUsed;
        // Prefer ordinal from "card0" / "card1" (Python uses xgmi index 0..N).
        const cardIndex = card.replace(/^card/i, '');
        return {
          index: String(cardIndex !== '' ? cardIndex : i),
          uuid: String(data['Unique ID'] ?? ''),
          name: String(data['Card series'] ?? data['Card SKU'] ?? ''),
          utilization: toNumber(data['GPU use (%)']),
          // Python AMD stubs encoder/decoder utilization to 0
          utilization_enc: 0,
          utilization_dec: 0,
          temperature: toNumber(data['Temperature (Sensor edge) (C)']),
          fan_speed: toNumber(data['Fan speed (%)']),
          memory_total: memoryTotal,
          memory_used: memoryUsed,
          memory_free: memoryFree,
          // Python AMD sets memory_available to total (not free) — keep parity
          memory_available: memoryTotal,
          power_draw: toNumber(
            data['Average Graphics Package Power (W)'] ??
              data['Current Socket Graphics Package Power (W)']
          ),
          power_limit: toNumber(data['Max Graphics Package Power (W)']),
        };
      });
  }

  /**
   * Detect a supported GPU and register observable gauges on the meter.
   * Returns the detected GPU type, or null if no supported GPU was found.
   */
  async setup(options: {
    meter: MeterType;
    environment: string;
    applicationName: string;
  }): Promise<GpuType | null> {
    this.gpuType = await this.detectGpuType();
    if (!this.gpuType) {
      // Match Python openlit.init(): skip quietly-ish when no GPU is present.
      // Use warn because OpenLIT sets DiagLogLevel.WARN (info is filtered).
      diag.warn(
        'OpenLIT: No supported GPUs found; skipping GPU metrics collection. ' +
          'If this is a non-GPU host, set `collectGpuStats: false` to disable GPU stats.'
      );
      return null;
    }

    const gauges: ObservableGauge[] = [];
    const gaugeByKey = new Map<ObservableGauge, GpuMetricKey>();
    for (const { semconv, key, description } of GPU_METRICS) {
      const gauge = options.meter.createObservableGauge(semconv, { description });
      gauges.push(gauge);
      gaugeByKey.set(gauge, key);
    }

    options.meter.addBatchObservableCallback(async (result: BatchObservableResult) => {
      let stats: GpuStats[];
      try {
        stats = await this.collectStats();
      } catch (e) {
        diag.error(`Error in GPU metrics collection: ${e}`);
        return;
      }

      for (const gpu of stats) {
        const attributes = {
          'telemetry.sdk.name': SDK_NAME,
          'service.name': options.applicationName,
          [SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]: options.environment,
          [SemanticConvention.GPU_INDEX]: gpu.index,
          [SemanticConvention.GPU_UUID]: gpu.uuid,
          [SemanticConvention.GPU_NAME]: gpu.name,
        };
        for (const gauge of gauges) {
          const key = gaugeByKey.get(gauge) as GpuMetricKey;
          result.observe(gauge, gpu[key], attributes);
        }
      }
    }, gauges);

    return this.gpuType;
  }
}

export default GpuMetricsCollector;
