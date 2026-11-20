import type { Meter } from '@opentelemetry/api';
import type { SetupMetricsOptions } from '../types';

/**
 * Edge builds send traces only: a metric reader needs a long-lived timer. The
 * instruments stay unset, and every caller already uses `?.` on them. Spans carry
 * the same tokens, cost and duration.
 */
const Metrics: any = class {
  static setup(_options: SetupMetricsOptions): Meter | undefined {
    return undefined;
  }

  static async forceFlush(): Promise<void> {}

  static async shutdown(): Promise<void> {}
};

export default Metrics;
