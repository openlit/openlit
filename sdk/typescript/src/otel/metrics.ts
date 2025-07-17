import { MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';
import { metrics } from '@opentelemetry/api';
import SemanticConvention from '../semantic-convention';
import { SetupMetricsOptions } from '../types';

export default class Metrics {
  static meterProvider: MeterProvider;
  static meter: ReturnType<typeof metrics.getMeter>;
  static metricReaders: PeriodicExportingMetricReader[] = [];

  static genaiClientUsageTokens: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]>;
  static genaiClientOperationDuration: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]>;
  static genaiServerTbt: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]>;
  static genaiServerTtft: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]>;
  static genaiRequests: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
  static genaiPromptTokens: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
  static genaiCompletionTokens: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
  static genaiReasoningTokens: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
  static genaiCost: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]>;

  static initializeMetrics() {
    this.genaiClientUsageTokens = this.meter.createHistogram(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, {
      description: 'Measures number of input and output tokens used',
      unit: '{token}',
    });
    this.genaiClientOperationDuration = this.meter.createHistogram(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, {
      description: 'GenAI operation duration',
      unit: 's',
    });
    this.genaiServerTbt = this.meter.createHistogram(SemanticConvention.GEN_AI_SERVER_TBT, {
      description: 'Time per output token generated after the first token for successful responses',
      unit: 's',
    });
    this.genaiServerTtft = this.meter.createHistogram(SemanticConvention.GEN_AI_SERVER_TTFT, {
      description: 'Time to generate first token for successful responses',
      unit: 's',
    });
    this.genaiRequests = this.meter.createCounter(SemanticConvention.GEN_AI_REQUESTS, {
      description: 'Number of requests to GenAI',
      unit: '1',
    });
    this.genaiPromptTokens = this.meter.createCounter(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, {
      description: 'Number of prompt tokens processed.',
      unit: '1',
    });
    this.genaiCompletionTokens = this.meter.createCounter(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, {
      description: 'Number of completion tokens processed.',
      unit: '1',
    });
    this.genaiReasoningTokens = this.meter.createCounter(SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS, {
      description: 'Number of reasoning thought tokens processed.',
      unit: '1',
    });
    this.genaiCost = this.meter.createHistogram(SemanticConvention.GEN_AI_USAGE_COST, {
      description: 'The distribution of GenAI request costs.',
      unit: 'USD',
    });
  }

  static setup(options: SetupMetricsOptions) {
    if (options.meter) return options.meter;
    try {
      const consoleMetricExporter = new ConsoleMetricExporter();
      const metricReader = new PeriodicExportingMetricReader({ exporter: consoleMetricExporter });
      this.meterProvider = new MeterProvider({
        resource: options.resource,
        readers: [metricReader],
      });
      this.meter = metrics.getMeter('openlit', '1.0.0');
      this.metricReaders.push(metricReader);
      metrics.setGlobalMeterProvider(this.meterProvider);
      this.initializeMetrics();
      return this.meter;
    } catch (e) {
      return null;
    }
  }
}
