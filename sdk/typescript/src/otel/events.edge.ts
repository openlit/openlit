import type { Logger } from '@opentelemetry/api-logs';
import type { SetupEventsOptions } from '../types';

/** Edge builds send traces only, so GenAI events are off. */
export default class Events {
  static logger: Logger | undefined;

  static setup(_options: SetupEventsOptions) {
    return undefined;
  }

  static async forceFlush(): Promise<void> {}

  static async shutdown(): Promise<void> {}
}
