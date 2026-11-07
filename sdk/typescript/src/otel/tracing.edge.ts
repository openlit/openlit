import { context, diag, propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SpanExporter,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import OpenlitConfig from '../config';
import Instrumentations from '../instrumentation';
import { hasAsyncContext } from '../platform';
import { SetupTracerOptions } from '../types';
import { BufferingSpanProcessor } from './buffering-span-processor';
import { PlatformContextManager } from './context-manager';

/**
 * Edge replacement for `otel/tracing.ts`. `setup()` does no I/O and starts no
 * timers, so it is safe at module scope in a Worker. The exporter is built on
 * first flush because bindings such as the OTLP endpoint arrive with the first
 * request; `disableBatch` has no effect, since a span sent outside `flush()` has
 * nothing keeping the invocation alive.
 */
export default class Tracing {
  static traceProvider: BasicTracerProvider;
  static spanProcessors: SpanProcessor[] = [];
  private static processor?: BufferingSpanProcessor;
  private static exporter?: SpanExporter;
  private static options?: SetupTracerOptions;
  static resource?: SetupTracerOptions['resource'];
  private static externalProvider?: { forceFlush?: () => Promise<void>; shutdown?: () => Promise<void> };

  static setup(options: SetupTracerOptions) {
    if (options.tracer) {
      this.externalProvider = options.tracer;
      return options.tracer;
    }

    if (!this.traceProvider) {
      this.options = options;
      this.resource = options.resource;
      this.processor = new BufferingSpanProcessor(() => this.getExporter());
      this.spanProcessors = [this.processor];
      this.traceProvider = new BasicTracerProvider({
        resource: options.resource,
        spanProcessors: this.spanProcessors,
      });
      trace.setGlobalTracerProvider(this.traceProvider);
      context.setGlobalContextManager(new PlatformContextManager());
      propagation.setGlobalPropagator(new W3CTraceContextPropagator());
      if (!hasAsyncContext()) {
        diag.warn(
          'OpenLIT: no AsyncLocalStorage in this runtime, so spans after an await lose their parent. ' +
            'Enable nodejs_compat, or pass parents explicitly with withParent().'
        );
      }

      OpenlitConfig.updateConfig({
        ...options,
        tracer: this.traceProvider as unknown as typeof OpenlitConfig.tracer,
      });
      Instrumentations.setup(this.traceProvider, options.disabledInstrumentors, options.instrumentations);
    }

    return trace.getTracer('openlit');
  }

  /** Apply settings that only became known with the first request. */
  static reconfigure(options: SetupTracerOptions) {
    this.options = options;
    this.resource = options.resource;
    this.exporter = undefined;
    OpenlitConfig.updateConfig({
      ...options,
      tracer: OpenlitConfig.tracer,
    });
  }

  private static getExporter(): SpanExporter {
    if (!this.exporter) {
      const { otlpEndpoint, otlpHeaders } = this.options ?? {};
      const inner = otlpEndpoint
        ? new OTLPTraceExporter({
            url: `${otlpEndpoint}/v1/traces`,
            headers: otlpHeaders as Record<string, string> | undefined,
          })
        : new ConsoleSpanExporter();
      this.exporter = {
        // The provider's resource is fixed at `setup()`, which can run before
        // bindings name the service, so the current one is applied on export.
        export: (spans, done) => {
          const resource = { value: this.resource };
          inner.export(spans.map((span) => Object.create(span, { resource })), done);
        },
        shutdown: () => inner.shutdown(),
      };
    }
    return this.exporter;
  }

  static async forceFlush(): Promise<void> {
    await (this.processor ?? this.externalProvider)?.forceFlush?.();
  }

  static async shutdown(): Promise<void> {
    await this.traceProvider?.shutdown();
  }

  static get droppedSpans(): number {
    return this.processor?.droppedSpans ?? 0;
  }

  static resetForTesting() {
    this.traceProvider = undefined as unknown as BasicTracerProvider;
    this.processor = undefined;
    this.exporter = undefined;
    this.spanProcessors = [];
    this.externalProvider = undefined;
  }
}
