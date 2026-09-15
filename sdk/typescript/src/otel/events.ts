import { logs } from '@opentelemetry/api-logs';
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
  ConsoleLogRecordExporter,
  LogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { SetupEventsOptions } from '../types';
import { parseExporters } from './utils';

let EVENTS_SET = false;

export default class Events {
  static loggerProvider: LoggerProvider;
  static logger: ReturnType<typeof logs.getLogger>;

  static setup(options: SetupEventsOptions) {
    try {
      if (!EVENTS_SET) {
        const existingProvider = logs.getLoggerProvider();
        const isSDKProvider =
          existingProvider &&
          typeof (existingProvider as any).forceFlush === 'function' &&
          existingProvider.constructor.name !== 'NoopLoggerProvider';

        if (isSDKProvider) {
          this.loggerProvider = existingProvider as unknown as LoggerProvider;
        } else {
          this.loggerProvider = Events.buildLoggerProvider(options);
          logs.setGlobalLoggerProvider(this.loggerProvider);
        }

        this.logger = this.loggerProvider.getLogger('openlit');
        EVENTS_SET = true;
      }

      return this.logger;
    } catch (e) {
      console.error('[Events] Failed to initialize events:', e);
      return null;
    }
  }

  private static buildLoggerProvider(options: SetupEventsOptions): LoggerProvider {
    const exporterList = parseExporters('OTEL_LOGS_EXPORTER');
    const processors: LogRecordProcessor[] = [];

    if (exporterList) {
      for (const name of exporterList) {
        if (name === 'otlp') {
          processors.push(Events.createOTLPProcessor(options));
        } else if (name === 'console') {
          processors.push(new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()));
        }
      }
    } else {
      if (options.otlpEndpoint) {
        processors.push(Events.createOTLPProcessor(options));
      } else {
        processors.push(new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()));
      }
    }

    return new LoggerProvider({
      resource: options.resource,
      processors,
    });
  }

  private static createOTLPProcessor(
    options: SetupEventsOptions
  ): BatchLogRecordProcessor | SimpleLogRecordProcessor {
    const url = (options.otlpEndpoint || '') + '/v1/logs';
    const exporter = new OTLPLogExporter({
      url,
      headers: options.otlpHeaders as Record<string, string> | undefined,
    });
    return options.disableBatch
      ? new SimpleLogRecordProcessor(exporter)
      : new BatchLogRecordProcessor(exporter);
  }

  static resetForTesting() {
    EVENTS_SET = false;
  }
}
