import { SetupTracerOptions } from './types';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  SpanExporter,
} from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

import Instrumentations from './instrumentation';
import OpenlitConfig from './config';

export default class Tracing {
  static traceProvider: NodeTracerProvider;
  static traceExporter: OTLPTraceExporter;
  static async setup(options: SetupTracerOptions) {
    if (options.tracer) return options.tracer;
    try {
      this.traceProvider = new NodeTracerProvider({
        resource: options.resource,
      });

      OpenlitConfig.updateConfig({
        ...options,
        tracer: options.tracer || Tracing.traceProvider,
      });

      Instrumentations.setup(
        Tracing.traceProvider,
        options?.disabledInstrumentations,
        options?.instrumentations
      );

      const consoleSpanExporter = new ConsoleSpanExporter();

      // Adding span to console
      this.traceProvider.addSpanProcessor(new SimpleSpanProcessor(consoleSpanExporter));

      this.traceExporter = new OTLPTraceExporter({
        url: options.otlpEndpoint,
        headers: options.otlpHeaders as Record<string, unknown> | undefined,
      });
      if (options.disableBatch) {
        this.traceProvider.addSpanProcessor(
          new SimpleSpanProcessor(this.traceExporter as SpanExporter)
        );
      } else {
        this.traceProvider.addSpanProcessor(
          new BatchSpanProcessor(this.traceExporter as SpanExporter)
        );
      }

      this.traceProvider.register();
    } catch (e) {
      return null;
    }
  }
}
