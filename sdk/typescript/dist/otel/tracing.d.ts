import { SetupTracerOptions } from '../types';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
export default class Tracing {
    static traceProvider: NodeTracerProvider;
    static traceExporter: OTLPTraceExporter | undefined;
    static setup(options: SetupTracerOptions): NodeTracerProvider | import("@opentelemetry/api").Tracer | null;
    private static buildSpanProcessors;
    private static createOTLPExporter;
    private static wrapProcessor;
    static resetForTesting(): void;
}
