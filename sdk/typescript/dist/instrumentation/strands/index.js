"use strict";
/**
 * OpenLIT Strands Agents Instrumentation
 *
 * Registers a StrandsSpanProcessor with the global TracerProvider to
 * enrich Strands' native OTel spans with OpenLIT attributes, content
 * capture, inference log events, and metrics -- without monkey-patching.
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/strands/__init__.py
 */
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const api_1 = require("@opentelemetry/api");
const constant_1 = require("../../constant");
const processor_1 = require("./processor");
const SUPPORTED_VERSIONS = ['>=0.1.0'];
class StrandsInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-strands`, '1.0.0', config);
        this._processor = null;
    }
    init() {
        return new instrumentation_1.InstrumentationNodeModuleDefinition('@strands-agents/sdk', SUPPORTED_VERSIONS, (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            this._unpatch();
            return moduleExports;
        });
    }
    enable() {
        super.enable();
        // Always register the processor eagerly so it works with both
        // CJS require hooks and ESM imports (where the module definition
        // hook may not fire because the module was already loaded).
        this._registerProcessor('unknown');
    }
    manualPatch(_moduleExports) {
        this._registerProcessor('unknown');
    }
    _patch(moduleExports) {
        try {
            let version = 'unknown';
            try {
                version = moduleExports?.version || 'unknown';
            }
            catch {
                // ignore
            }
            this._registerProcessor(version);
        }
        catch {
            // ignore
        }
    }
    _registerProcessor(strandsVersion) {
        if (this._processor)
            return;
        this._processor = new processor_1.StrandsSpanProcessor(strandsVersion);
        const provider = api_1.trace.getTracerProvider();
        const actual = provider._delegate || provider;
        const activeProcessor = actual._activeSpanProcessor;
        if (activeProcessor && Array.isArray(activeProcessor._spanProcessors)) {
            activeProcessor._spanProcessors.unshift(this._processor);
        }
        else if (typeof actual.addSpanProcessor === 'function') {
            actual.addSpanProcessor(this._processor);
        }
    }
    _unpatch() {
        if (this._processor) {
            try {
                this._processor.shutdown();
            }
            catch {
                // ignore
            }
            this._processor = null;
        }
    }
}
exports.default = StrandsInstrumentation;
//# sourceMappingURL=index.js.map