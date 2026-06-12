import { trace } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { SetupTracerOptions } from '../types';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  SpanExporter,
} from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

import Instrumentations from '../instrumentation';
import OpenlitConfig from '../config';
import { getRegisteredTracerProvider, parseExporters } from './utils';

let TRACER_SET = false;

export default class Tracing {
  static traceProvider: BasicTracerProvider;
  static traceExporter: OTLPTraceExporter | undefined;

  static setup(options: SetupTracerOptions) {
    // If an external tracer is provided, return it immediately (Python parity).
    if (options.tracer) return options.tracer;

    try {
      if (!TRACER_SET) {
        const existingProvider = getRegisteredTracerProvider();

        if (existingProvider) {
          // Reuse the host app's SDK TracerProvider — do not register a second one.
          this.traceProvider = existingProvider;
        } else {
          // No SDK provider configured yet — create one.
          const spanProcessors = Tracing.buildSpanProcessors(options);

          const provider = new NodeTracerProvider({
            resource: options.resource,
            spanProcessors,
          });

          provider.register();
          this.traceProvider = provider;
        }

        OpenlitConfig.updateConfig({
          ...options,
          tracer: (options.tracer || Tracing.traceProvider) as NodeTracerProvider,
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
  }
}
