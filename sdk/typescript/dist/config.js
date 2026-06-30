"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class OpenlitConfig {
    static updateConfig({ environment = 'default', applicationName = 'default', tracer, otlpEndpoint, otlpHeaders, disableBatch = false, captureMessageContent = true, pricingJson, disableMetrics = false, disableEvents = false, maxContentLength = null, customSpanAttributes = null, openlitApiKey, openlitUrl, }) {
        this.environment = environment;
        this.applicationName = applicationName;
        this.tracer = tracer;
        this.otlpEndpoint = otlpEndpoint;
        this.otlpHeaders = otlpHeaders;
        this.disableBatch = disableBatch;
        this.captureMessageContent = captureMessageContent;
        this.pricingJson = pricingJson;
        this.disableMetrics = disableMetrics;
        this.disableEvents = disableEvents;
        this.maxContentLength = maxContentLength;
        this.customSpanAttributes = customSpanAttributes;
        this.openlitApiKey = openlitApiKey;
        this.openlitUrl = openlitUrl;
    }
}
exports.default = OpenlitConfig;
//# sourceMappingURL=config.js.map