import { diag } from '@opentelemetry/api';
import type { Meter, Attributes } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import SemanticConvention from '../../semantic-convention';
import {
  GpuStatsRow,
  isNvidiaSmiAvailable,
  queryNvidiaSmi,
} from './collector';

/**
 * The 11 GPU gauges, mapping each OpenLIT metric name to a field on
 * {@link GpuStatsRow}. Names are kept identical to the Python `gpu`
 * instrumentor so both SDKs feed the same OpenLIT dashboards.
 *
 * Note: `gpu.memory.available` intentionally maps to free memory, matching
 * the Python instrumentor (which assumes reserved memory is 0).
 */
const GPU_METRICS: ReadonlyArray<{
  name: string;
  field: keyof GpuStatsRow;
  description: string;
}> = [
  { name: SemanticConvention.GPU_UTILIZATION, field: 'utilization', description: 'GPU Utilization' },
  { name: SemanticConvention.GPU_UTILIZATION_ENC, field: 'utilizationEnc', description: 'GPU Utilization Enc' },
  { name: SemanticConvention.GPU_UTILIZATION_DEC, field: 'utilizationDec', description: 'GPU Utilization Dec' },
  { name: SemanticConvention.GPU_TEMPERATURE, field: 'temperature', description: 'GPU Temperature' },
  { name: SemanticConvention.GPU_FAN_SPEED, field: 'fanSpeed', description: 'GPU Fan Speed' },
  { name: SemanticConvention.GPU_MEMORY_AVAILABLE, field: 'memoryFree', description: 'GPU Memory Available' },
  { name: SemanticConvention.GPU_MEMORY_TOTAL, field: 'memoryTotal', description: 'GPU Memory Total' },
  { name: SemanticConvention.GPU_MEMORY_USED, field: 'memoryUsed', description: 'GPU Memory Used' },
  { name: SemanticConvention.GPU_MEMORY_FREE, field: 'memoryFree', description: 'GPU Memory Free' },
  { name: SemanticConvention.GPU_POWER_DRAW, field: 'powerDraw', description: 'GPU Power Draw' },
  { name: SemanticConvention.GPU_POWER_LIMIT, field: 'powerLimit', description: 'GPU Power Limit' },
];

export interface GpuInstrumentationOptions {
  meter: Meter;
  environment: string;
  applicationName: string;
  /** Injectable for tests. Defaults to a real `nvidia-smi` query. */
  queryFn?: () => Promise<GpuStatsRow[]>;
  /** Injectable for tests. Defaults to a real `nvidia-smi -L` probe. */
  detectFn?: () => Promise<boolean>;
}

/**
 * Register GPU metric collection on the given meter. Detects a GPU once (via
 * `nvidia-smi`); if none is present it logs and no-ops, mirroring the Python
 * instrumentor. When present, it registers 11 observable gauges and a single
 * batch callback that runs one `nvidia-smi` query per export tick and reports
 * every metric for every GPU.
 *
 * @returns true if GPU collection was registered, false if no GPU was found.
 */
export async function setupGpuInstrumentation(
  options: GpuInstrumentationOptions
): Promise<boolean> {
  const { meter, environment, applicationName } = options;
  const detectFn = options.detectFn ?? (() => isNvidiaSmiAvailable());
  const queryFn = options.queryFn ?? (() => queryNvidiaSmi());

  const available = await detectFn();
  if (!available) {
    diag.error(
      'OpenLIT GPU Instrumentation Error: No supported GPUs found (nvidia-smi unavailable). ' +
        'If this is a non-GPU host, set `collectGpuStats: false` to disable GPU stats.'
    );
    return false;
  }

  const gauges = GPU_METRICS.map((m) => ({
    field: m.field,
    gauge: meter.createObservableGauge(m.name, { description: m.description }),
  }));

  meter.addBatchObservableCallback(
    async (result) => {
      let rows: GpuStatsRow[];
      try {
        rows = await queryFn();
      } catch (e) {
        diag.error(`OpenLIT GPU Instrumentation: metric collection failed: ${e}`);
        return;
      }

      for (const row of rows) {
        const attributes: Attributes = {
          [ATTR_TELEMETRY_SDK_NAME]: 'openlit',
          [ATTR_SERVICE_NAME]: applicationName,
          [SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]: environment,
          [SemanticConvention.GPU_INDEX]: String(row.index),
          [SemanticConvention.GPU_UUID]: row.uuid,
          [SemanticConvention.GPU_NAME]: row.name,
        };
        for (const { gauge, field } of gauges) {
          result.observe(gauge, row[field] as number, attributes);
        }
      }
    },
    gauges.map((g) => g.gauge)
  );

  return true;
}

export { GpuStatsRow } from './collector';
