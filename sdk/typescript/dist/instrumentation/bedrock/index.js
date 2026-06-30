"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitBedrockInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-bedrock`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@aws-sdk/client-bedrock-runtime', ['>=3.0.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(bedrock) {
        this._patch(bedrock);
    }
    _patch(moduleExports) {
        try {
            const BedrockRuntimeClient = moduleExports.BedrockRuntimeClient;
            if (!BedrockRuntimeClient?.prototype)
                return;
            if ((0, instrumentation_1.isWrapped)(BedrockRuntimeClient.prototype.send)) {
                this._unwrap(BedrockRuntimeClient.prototype, 'send');
            }
            this._wrap(BedrockRuntimeClient.prototype, 'send', wrapper_1.default._patchSend(this.tracer));
        }
        catch (e) {
            console.error('Error in Bedrock _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        try {
            const BedrockRuntimeClient = moduleExports.BedrockRuntimeClient;
            if (BedrockRuntimeClient?.prototype?.send) {
                this._unwrap(BedrockRuntimeClient.prototype, 'send');
            }
        }
        catch { /* ignore */ }
    }
}
exports.default = OpenlitBedrockInstrumentation;
//# sourceMappingURL=index.js.map