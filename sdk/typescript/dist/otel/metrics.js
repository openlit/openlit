"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_metrics_1 = require("@opentelemetry/sdk-metrics");
const api_1 = require("@opentelemetry/api");
const semantic_convention_1 = __importDefault(require("../semantic-convention"));
const exporter_metrics_otlp_http_1 = require("@opentelemetry/exporter-metrics-otlp-http");
const utils_1 = require("./utils");
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
class Metrics {
    static initializeMetrics() {
        this.genaiClientUsageTokens = this.meter.createHistogram(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE, {
            description: 'Measures number of input and output tokens used',
            unit: '{token}',
            advice: {
                explicitBucketBoundaries: GEN_AI_CLIENT_TOKEN_USAGE_BUCKETS,
            },
        });
        this.genaiClientOperationDuration = this.meter.createHistogram(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, {
            description: 'GenAI operation duration',
            unit: 's',
            advice: {
                explicitBucketBoundaries: GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS,
            },
        });
        this.genaiServerTbt = this.meter.createHistogram(semantic_convention_1.default.GEN_AI_SERVER_TBT, {
            description: 'Time per output token generated after the first token for successful responses',
            unit: 's',
            advice: {
                explicitBucketBoundaries: GEN_AI_SERVER_TBT,
            },
        });
        this.genaiServerTtft = this.meter.createHistogram(semantic_convention_1.default.GEN_AI_SERVER_TTFT, {
            description: 'Time to generate first token for successful responses',
            unit: 's',
            advice: {
                explicitBucketBoundaries: GEN_AI_SERVER_TFTT,
            },
        });
        this.genaiClientTimeToFirstChunk = this.meter.createHistogram(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_TIME_TO_FIRST_CHUNK, {
            description: 'Time from client request to first response chunk',
            unit: 's',
            advice: {
                explicitBucketBoundaries: GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS,
            },
        });
        this.genaiClientTimePerOutputChunk = this.meter.createHistogram(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_TIME_PER_OUTPUT_CHUNK, {
            description: 'Time between consecutive response chunks from client perspective',
            unit: 's',
            advice: {
                explicitBucketBoundaries: GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS,
            },
        });
        this.genaiServerRequestDuration = this.meter.createHistogram(semantic_convention_1.default.GEN_AI_SERVER_REQUEST_DURATION, {
            description: 'Total server-side processing time from request receipt to response transmission',
            unit: 's',
            advice: {
                explicitBucketBoundaries: GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS,
            },
        });
        this.dbClientOperationDuration = this.meter.createHistogram(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, {
            description: 'DB operation duration',
            unit: 's',
            advice: {
                explicitBucketBoundaries: DB_CLIENT_OPERATION_DURATION_BUCKETS,
            },
        });
        this.genaiCost = this.meter.createHistogram(semantic_convention_1.default.GEN_AI_USAGE_COST, {
            description: 'The distribution of GenAI request costs.',
            unit: 'USD',
        });
        this.dbRequests = this.meter.createCounter(semantic_convention_1.default.DB_REQUESTS, {
            description: 'Number of requests to VectorDBs.',
            unit: '1',
        });
        this.guardRequests = this.meter.createCounter(semantic_convention_1.default.GUARD_REQUESTS_COUNTER, {
            description: 'Number of guard evaluations.',
            unit: '1',
        });
        // MCP metrics
        this.mcpRequests = this.meter.createCounter(semantic_convention_1.default.MCP_REQUESTS, {
            description: 'Number of MCP requests.',
            unit: '1',
        });
        this.mcpClientOperationDuration = this.meter.createHistogram(semantic_convention_1.default.MCP_CLIENT_OPERATION_DURATION_METRIC, {
            description: 'MCP client operation duration',
            unit: 's',
            advice: {
                explicitBucketBoundaries: GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS,
            },
        });
        this.mcpRequestSize = this.meter.createHistogram(semantic_convention_1.default.MCP_REQUEST_SIZE, {
            description: 'MCP request payload size in bytes',
            unit: 'By',
        });
        this.mcpResponseSize = this.meter.createHistogram(semantic_convention_1.default.MCP_RESPONSE_SIZE_METRIC, {
            description: 'MCP response payload size in bytes',
            unit: 'By',
        });
        this.mcpToolCalls = this.meter.createCounter(semantic_convention_1.default.MCP_TOOL_CALLS, {
            description: 'Number of MCP tool calls.',
            unit: '1',
        });
        this.mcpResourceReads = this.meter.createCounter(semantic_convention_1.default.MCP_RESOURCE_READS, {
            description: 'Number of MCP resource reads.',
            unit: '1',
        });
        this.mcpPromptGets = this.meter.createCounter(semantic_convention_1.default.MCP_PROMPT_GETS, {
            description: 'Number of MCP prompt gets.',
            unit: '1',
        });
        this.mcpTransportUsage = this.meter.createCounter(semantic_convention_1.default.MCP_TRANSPORT_USAGE, {
            description: 'Number of MCP transport operations.',
            unit: '1',
        });
        this.mcpErrors = this.meter.createCounter(semantic_convention_1.default.MCP_ERRORS, {
            description: 'Number of MCP errors.',
            unit: '1',
        });
        this.mcpOperationSuccessRate = this.meter.createHistogram(semantic_convention_1.default.MCP_OPERATION_SUCCESS_RATE, {
            description: 'MCP operation success rate (0.0 = failure, 1.0 = success)',
            unit: '1',
        });
    }
    static setup(options) {
        if (options.meter) {
            this.meter = options.meter;
            this.initializeMetrics();
            return this.meter;
        }
        try {
            if (!METER_SET) {
                const existingProvider = api_1.metrics.getMeterProvider();
                const isSDKProvider = existingProvider &&
                    typeof existingProvider.getMeter === 'function' &&
                    existingProvider.constructor.name !== 'NoopMeterProvider';
                if (isSDKProvider) {
                    this.meterProvider = existingProvider;
                }
                else {
                    const readers = Metrics.buildMetricReaders(options);
                    this.meterProvider = new sdk_metrics_1.MeterProvider({
                        resource: options.resource,
                        readers,
                    });
                    api_1.metrics.setGlobalMeterProvider(this.meterProvider);
                    this.metricReaders.push(...readers);
                }
                this.meter = this.meterProvider.getMeter('openlit', '1.0.0');
                this.initializeMetrics();
                METER_SET = true;
            }
            return this.meter;
        }
        catch (e) {
            console.error('[Metrics] Failed to initialize metrics:', e);
            return null;
        }
    }
    static buildMetricReaders(options) {
        const readers = [];
        const exporterList = (0, utils_1.parseExporters)('OTEL_METRICS_EXPORTER');
        if (exporterList) {
            for (const name of exporterList) {
                if (name === 'otlp') {
                    readers.push(Metrics.createOTLPReader(options));
                }
                else if (name === 'console') {
                    readers.push(Metrics.createConsoleReader(options));
                }
            }
        }
        else {
            if (options.otlpEndpoint) {
                readers.push(Metrics.createOTLPReader(options));
            }
            else {
                readers.push(Metrics.createConsoleReader(options));
            }
        }
        return readers;
    }
    static createOTLPReader(options) {
        const url = (options.otlpEndpoint || '') + '/v1/metrics';
        const exporter = new exporter_metrics_otlp_http_1.OTLPMetricExporter({
            url,
            headers: options.otlpHeaders,
        });
        return new sdk_metrics_1.PeriodicExportingMetricReader({
            exportIntervalMillis: options.exportIntervalMillis || 60000,
            exporter,
        });
    }
    static createConsoleReader(options) {
        return new sdk_metrics_1.PeriodicExportingMetricReader({
            exportIntervalMillis: options.exportIntervalMillis || 60000,
            exporter: new sdk_metrics_1.ConsoleMetricExporter(),
        });
    }
    static resetForTesting() {
        METER_SET = false;
    }
}
Metrics.metricReaders = [];
exports.default = Metrics;
//# sourceMappingURL=metrics.js.map