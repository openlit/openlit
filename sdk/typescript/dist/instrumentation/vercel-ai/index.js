"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
// Functions to intercept from the `ai` module
const PATCHED_FNS = ['generateText', 'streamText', 'generateObject', 'embed'];
class OpenlitVercelAIInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-vercel-ai`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('ai', ['>=3.0.0 <5'], (moduleExports) => this._patch(moduleExports), 
        // No-op unpatch: Proxy is discarded when the module is re-required
        () => { });
        return [module];
    }
    manualPatch(ai) {
        return this._patch(ai);
    }
    _patch(moduleExports) {
        try {
            const tracer = this.tracer;
            // The `ai` package exports functions as non-configurable getter properties,
            // so shimmer's Object.defineProperty-based wrapping fails. Instead, return a
            // Proxy that intercepts property access and returns wrapped functions.
            const patchers = {
                generateText: wrapper_1.default._patchGenerateText,
                streamText: wrapper_1.default._patchStreamText,
                generateObject: wrapper_1.default._patchGenerateObject,
                embed: wrapper_1.default._patchEmbed,
            };
            // Pre-build wrapped functions once (avoid re-wrapping on every get)
            const wrapped = {};
            for (const name of PATCHED_FNS) {
                const original = moduleExports[name];
                if (typeof original === 'function') {
                    wrapped[name] = patchers[name](tracer)(original);
                }
            }
            return new Proxy(moduleExports, {
                get(target, prop, receiver) {
                    if (prop in wrapped)
                        return wrapped[prop];
                    return Reflect.get(target, prop, receiver);
                },
            });
        }
        catch (e) {
            console.error('Error in VercelAI _patch method:', e);
            return moduleExports;
        }
    }
}
exports.default = OpenlitVercelAIInstrumentation;
//# sourceMappingURL=index.js.map