import {
  MeterProvider,
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { metrics } from '@opentelemetry/api';
import SemanticConvention from '../semantic-convention';
import { SetupMetricsOptions } from '../types';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { parseExporters } from './utils';

const DB_CLIENT_OPERATION_DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10];

const GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92,
];

const GEN_AI_SERVER_TBT = [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0, 2.5];

const GEN_AI_SERVER_TFTT = [
  0.001, 0.005, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 7.5, 10.0,
];

const GEN_AI_CLIENT_TOKEN_USAGE_BUCKETS = [
  1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864,
];

let METER_SET = false;

export default class Metrics {
  static meterProvider: MeterProvider;
  static meter: ReturnType<typeof metrics.getMeter>;
  static metricReaders: PeriodicExportingMetricReader[] = [];

  static genaiClientUsageTokens: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']>;
  static genaiClientOperationDuration: ReturnType<
    ReturnType<typeof metrics.getMeter>['createHistogram']
  >;
  static genaiServerTbt: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']>;
  static genaiServerTtft: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']>;
  static genaiClientTimeToFirstChunk: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']>;
  static genaiClientTimePerOutputChunk: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']>;
  static genaiServerRequestDuration: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']>;
  static dbClientOperationDuration: ReturnType<
    ReturnType<typeof metrics.getMeter>['createHistogram']
  >;
  static genaiCost: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']>;
  static dbRequests: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']>;

  static initializeMetrics() {
    this.genaiClientUsageTokens = this.meter.createHistogram(
      SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
      {
        description: 'Measures number of input and output tokens used',
        unit: '{token}',
        advice: {
          explicitBucketBoundaries: GEN_AI_CLIENT_TOKEN_USAGE_BUCKETS,
        },
      }
    );
    this.genaiClientOperationDuration = this.meter.createHistogram(
      SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
      {
        description: 'GenAI operation duration',
        unit: 's',
        advice: {
          explicitBucketBoundaries: GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS,
        },
      }
    );
    this.genaiServerTbt = this.meter.createHistogram(SemanticConvention.GEN_AI_SERVER_TBT, {
      description: 'Time per output token generated after the first token for successful responses',
      unit: 's',
      advice: {
        explicitBucketBoundaries: GEN_AI_SERVER_TBT,
      },
    });
    this.genaiServerTtft = this.meter.createHistogram(SemanticConvention.GEN_AI_SERVER_TTFT, {
      description: 'Time to generate first token for successful responses',
      unit: 's',
      advice: {
        explicitBucketBoundaries: GEN_AI_SERVER_TFTT,
      },
    });
    this.genaiClientTimeToFirstChunk = this.meter.createHistogram(
      SemanticConvention.GEN_AI_CLIENT_OPERATION_TIME_TO_FIRST_CHUNK,
      {
        description: 'Time from client request to first response chunk',
        unit: 's',
        advice: {
          explicitBucketBoundaries: GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS,
        },
      }
    );
    this.genaiClientTimePerOutputChunk = this.meter.createHistogram(
      SemanticConvention.GEN_AI_CLIENT_OPERATION_TIME_PER_OUTPUT_CHUNK,
      {
        description: 'Time between consecutive response chunks from client perspective',
        unit: 's',
        advice: {
          explicitBucketBoundaries: GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS,
        },
      }
    );
    this.genaiServerRequestDuration = this.meter.createHistogram(
      SemanticConvention.GEN_AI_SERVER_REQUEST_DURATION,
      {
        description: 'Total server-side processing time from request receipt to response transmission',
        unit: 's',
        advice: {
          explicitBucketBoundaries: GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS,
        },
      }
    );
    this.dbClientOperationDuration = this.meter.createHistogram(
      SemanticConvention.DB_CLIENT_OPERATION_DURATION,
      {
        description: 'DB operation duration',
        unit: 's',
        advice: {
          explicitBucketBoundaries: DB_CLIENT_OPERATION_DURATION_BUCKETS,
        },
      }
    );
    this.genaiCost = this.meter.createHistogram(SemanticConvention.GEN_AI_USAGE_COST, {
      description: 'The distribution of GenAI request costs.',
      unit: 'USD',
    });
    this.dbRequests = this.meter.createCounter(SemanticConvention.DB_REQUESTS, {
      description: 'Number of requests to VectorDBs.',
      unit: '1',
    });
  }

  static setup(options: SetupMetricsOptions) {
    if (options.meter) {
      this.meter = options.meter;
      this.initializeMetrics();
      return this.meter;
    }

    try {
      if (!METER_SET) {
        const existingProvider = metrics.getMeterProvider();
        const isSDKProvider =
          existingProvider &&
          typeof (existingProvider as any).getMeter === 'function' &&
          existingProvider.constructor.name !== 'NoopMeterProvider';

        if (isSDKProvider) {
          this.meterProvider = existingProvider as unknown as MeterProvider;
        } else {
          const readers = Metrics.buildMetricReaders(options);
          this.meterProvider = new MeterProvider({
            resource: options.resource,
            readers,
          });
          metrics.setGlobalMeterProvider(this.meterProvider);
          this.metricReaders.push(...(readers as PeriodicExportingMetricReader[]));
        }

        this.meter = this.meterProvider.getMeter('openlit', '1.0.0');
        this.initializeMetrics();
        METER_SET = true;
      }

      return this.meter;
    } catch (e) {
      console.error('[Metrics] Failed to initialize metrics:', e);
      return null;
    }
  }

  private static buildMetricReaders(options: SetupMetricsOptions) {
    const readers: PeriodicExportingMetricReader[] = [];
    const exporterList = parseExporters('OTEL_METRICS_EXPORTER');

    if (exporterList) {
      for (const name of exporterList) {
        if (name === 'otlp') {
          readers.push(Metrics.createOTLPReader(options));
        } else if (name === 'console') {
          readers.push(Metrics.createConsoleReader(options));
        }
      }
    } else {
      if (options.otlpEndpoint) {
        readers.push(Metrics.createOTLPReader(options));
      } else {
        readers.push(Metrics.createConsoleReader(options));
      }
    }

    return readers;
  }

  private static createOTLPReader(options: SetupMetricsOptions): PeriodicExportingMetricReader {
    const url = (options.otlpEndpoint || '') + '/v1/metrics';
    const exporter = new OTLPMetricExporter({
      url,
      headers: options.otlpHeaders as Record<string, string> | undefined,
    });
    return new PeriodicExportingMetricReader({
      exportIntervalMillis: options.exportIntervalMillis || 60000,
      exporter,
    });
  }

  private static createConsoleReader(options: SetupMetricsOptions): PeriodicExportingMetricReader {
    return new PeriodicExportingMetricReader({
      exportIntervalMillis: options.exportIntervalMillis || 60000,
      exporter: new ConsoleMetricExporter(),
    });
  }

  static resetForTesting() {
    METER_SET = false;
  }
}
