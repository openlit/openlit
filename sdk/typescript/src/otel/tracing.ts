import { trace } from '@opentelemetry/api';
import { SetupTracerOptions } from '../types';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  SpanExporter,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

import Instrumentations from '../instrumentation';
import OpenlitConfig from '../config';
import { parseExporters } from './utils';

let TRACER_SET = false;

export default class Tracing {
  static traceProvider: NodeTracerProvider;
  static traceExporter: OTLPTraceExporter | undefined;
  /** Set only when OpenLIT created the provider. */
  static spanProcessors: SpanProcessor[] = [];
  static resource?: SetupTracerOptions['resource'];
  private static externalProvider?: { forceFlush?: () => Promise<void>; shutdown?: () => Promise<void> };

  static setup(options: SetupTracerOptions) {
    if (options.tracer) {
      this.externalProvider = options.tracer;
      return options.tracer;
    }

    try {
      if (!TRACER_SET) {
        const existingProvider = trace.getTracerProvider();
        const isSDKProvider =
          existingProvider &&
          typeof (existingProvider as any).addSpanProcessor === 'function';

        if (isSDKProvider) {
          // Reuse existing SDK TracerProvider
          this.traceProvider = existingProvider as unknown as NodeTracerProvider;
        } else {
          const spanProcessors = Tracing.buildSpanProcessors(options);
          this.spanProcessors = spanProcessors;
          this.resource = options.resource;

          this.traceProvider = new NodeTracerProvider({
            resource: options.resource,
            spanProcessors,
          });

          this.traceProvider.register();
        }

        OpenlitConfig.updateConfig({
          ...options,
          tracer: options.tracer || Tracing.traceProvider,
        });

        Instrumentations.setup(
          Tracing.traceProvider,
          options?.disabledInstrumentors,
          options?.instrumentations
        );

        TRACER_SET = true;
      }

      return trace.getTracer('openlit');
    } catch (e) {
      console.error('[Traces] Failed to initialize traces:', e);
      return null;
    }
  }

  /** Node reads its settings at `init()`, so runtime options have nothing to change here. */
  static reconfigure(_options: SetupTracerOptions) {}

  static async forceFlush(): Promise<void> {
    await (this.traceProvider ?? this.externalProvider)?.forceFlush?.();
  }

  static async shutdown(): Promise<void> {
    await this.traceProvider?.shutdown();
  }

  /** The Node batch processor applies its own limit and keeps no count. */
  static get droppedSpans(): number {
    return 0;
  }

  private static buildSpanProcessors(options: SetupTracerOptions) {
    const processors: (SimpleSpanProcessor | BatchSpanProcessor)[] = [];
    const exporterList = parseExporters('OTEL_TRACES_EXPORTER');

    if (exporterList) {
      for (const name of exporterList) {
        if (name === 'otlp') {
          const exporter = Tracing.createOTLPExporter(options);
          this.traceExporter = exporter;
          processors.push(Tracing.wrapProcessor(exporter, options.disableBatch));
        } else if (name === 'console') {
          processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
        }
      }
    } else {
      // Default: OTLP if endpoint is set, otherwise Console
      if (options.otlpEndpoint) {
        const exporter = Tracing.createOTLPExporter(options);
        this.traceExporter = exporter;
        processors.push(Tracing.wrapProcessor(exporter, options.disableBatch));
      } else {
        processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
      }
    }

    return processors;
  }

  private static createOTLPExporter(options: SetupTracerOptions): OTLPTraceExporter {
    const url = (options.otlpEndpoint || '') + '/v1/traces';
    return new OTLPTraceExporter({
      url,
      headers: options.otlpHeaders as Record<string, string> | undefined,
    });
  }

  private static wrapProcessor(
    exporter: SpanExporter,
    disableBatch: boolean
  ): SimpleSpanProcessor | BatchSpanProcessor {
    return disableBatch
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter);
  }

  static resetForTesting() {
    TRACER_SET = false;
    this.spanProcessors = [];
    this.externalProvider = undefined;
  }
}
