"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const sdk_trace_node_1 = require("@opentelemetry/sdk-trace-node");
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
const instrumentation_1 = __importDefault(require("../instrumentation"));
const config_1 = __importDefault(require("../config"));
const utils_1 = require("./utils");
let TRACER_SET = false;
class Tracing {
    static setup(options) {
        if (options.tracer)
            return options.tracer;
        try {
            if (!TRACER_SET) {
                const existingProvider = api_1.trace.getTracerProvider();
                const isSDKProvider = existingProvider &&
                    typeof existingProvider.addSpanProcessor === 'function';
                if (isSDKProvider) {
                    // Reuse existing SDK TracerProvider
                    this.traceProvider = existingProvider;
                }
                else {
                    const spanProcessors = Tracing.buildSpanProcessors(options);
                    this.traceProvider = new sdk_trace_node_1.NodeTracerProvider({
                        resource: options.resource,
                        spanProcessors,
                    });
                    this.traceProvider.register();
                }
                config_1.default.updateConfig({
                    ...options,
                    tracer: options.tracer || Tracing.traceProvider,
                });
                instrumentation_1.default.setup(Tracing.traceProvider, options?.disabledInstrumentors, options?.instrumentations);
                TRACER_SET = true;
            }
            return api_1.trace.getTracer('openlit');
        }
        catch (e) {
            console.error('[Traces] Failed to initialize traces:', e);
            return null;
        }
    }
    static buildSpanProcessors(options) {
        const processors = [];
        const exporterList = (0, utils_1.parseExporters)('OTEL_TRACES_EXPORTER');
        if (exporterList) {
            for (const name of exporterList) {
                if (name === 'otlp') {
                    const exporter = Tracing.createOTLPExporter(options);
                    this.traceExporter = exporter;
                    processors.push(Tracing.wrapProcessor(exporter, options.disableBatch));
                }
                else if (name === 'console') {
                    processors.push(new sdk_trace_node_1.SimpleSpanProcessor(new sdk_trace_node_1.ConsoleSpanExporter()));
                }
            }
        }
        else {
            // Default: OTLP if endpoint is set, otherwise Console
            if (options.otlpEndpoint) {
                const exporter = Tracing.createOTLPExporter(options);
                this.traceExporter = exporter;
                processors.push(Tracing.wrapProcessor(exporter, options.disableBatch));
            }
            else {
                processors.push(new sdk_trace_node_1.SimpleSpanProcessor(new sdk_trace_node_1.ConsoleSpanExporter()));
            }
        }
        return processors;
    }
    static createOTLPExporter(options) {
        const url = (options.otlpEndpoint || '') + '/v1/traces';
        return new exporter_trace_otlp_http_1.OTLPTraceExporter({
            url,
            headers: options.otlpHeaders,
        });
    }
    static wrapProcessor(exporter, disableBatch) {
        return disableBatch
            ? new sdk_trace_node_1.SimpleSpanProcessor(exporter)
            : new sdk_trace_node_1.BatchSpanProcessor(exporter);
    }
    static resetForTesting() {
        TRACER_SET = false;
    }
}
exports.default = Tracing;
//# sourceMappingURL=tracing.js.map