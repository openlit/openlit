"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_logs_1 = require("@opentelemetry/api-logs");
const sdk_logs_1 = require("@opentelemetry/sdk-logs");
const exporter_logs_otlp_http_1 = require("@opentelemetry/exporter-logs-otlp-http");
const utils_1 = require("./utils");
let EVENTS_SET = false;
class Events {
    static setup(options) {
        try {
            if (!EVENTS_SET) {
                const existingProvider = api_logs_1.logs.getLoggerProvider();
                const isSDKProvider = existingProvider &&
                    typeof existingProvider.forceFlush === 'function' &&
                    existingProvider.constructor.name !== 'NoopLoggerProvider';
                if (isSDKProvider) {
                    this.loggerProvider = existingProvider;
                }
                else {
                    this.loggerProvider = Events.buildLoggerProvider(options);
                    api_logs_1.logs.setGlobalLoggerProvider(this.loggerProvider);
                }
                this.logger = this.loggerProvider.getLogger('openlit');
                EVENTS_SET = true;
            }
            return this.logger;
        }
        catch (e) {
            console.error('[Events] Failed to initialize events:', e);
            return null;
        }
    }
    static buildLoggerProvider(options) {
        const exporterList = (0, utils_1.parseExporters)('OTEL_LOGS_EXPORTER');
        const processors = [];
        if (exporterList) {
            for (const name of exporterList) {
                if (name === 'otlp') {
                    processors.push(Events.createOTLPProcessor(options));
                }
                else if (name === 'console') {
                    processors.push(new sdk_logs_1.SimpleLogRecordProcessor(new sdk_logs_1.ConsoleLogRecordExporter()));
                }
            }
        }
        else {
            if (options.otlpEndpoint) {
                processors.push(Events.createOTLPProcessor(options));
            }
            else {
                processors.push(new sdk_logs_1.SimpleLogRecordProcessor(new sdk_logs_1.ConsoleLogRecordExporter()));
            }
        }
        return new sdk_logs_1.LoggerProvider({
            resource: options.resource,
            processors,
        });
    }
    static createOTLPProcessor(options) {
        const url = (options.otlpEndpoint || '') + '/v1/logs';
        const exporter = new exporter_logs_otlp_http_1.OTLPLogExporter({
            url,
            headers: options.otlpHeaders,
        });
        return options.disableBatch
            ? new sdk_logs_1.SimpleLogRecordProcessor(exporter)
            : new sdk_logs_1.BatchLogRecordProcessor(exporter);
    }
    static resetForTesting() {
        EVENTS_SET = false;
    }
}
exports.default = Events;
//# sourceMappingURL=events.js.map