"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitReplicateInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-replicate`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('replicate', ['>=0.25.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(replicate) {
        this._patch(replicate);
    }
    _patch(moduleExports) {
        try {
            // Replicate can be default export (ESM) or module itself (CJS)
            const ReplicateClass = moduleExports.default ?? moduleExports.Replicate ?? moduleExports;
            const proto = ReplicateClass?.prototype;
            if (!proto)
                return;
            if (typeof proto.run === 'function') {
                if ((0, instrumentation_1.isWrapped)(proto.run)) {
                    this._unwrap(proto, 'run');
                }
                this._wrap(proto, 'run', wrapper_1.default._patchRun(this.tracer));
            }
        }
        catch (e) {
            console.error('Error in Replicate _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        try {
            const ReplicateClass = moduleExports.default ?? moduleExports.Replicate ?? moduleExports;
            const proto = ReplicateClass?.prototype;
            if (proto && typeof proto.run === 'function') {
                this._unwrap(proto, 'run');
            }
        }
        catch { /* ignore */ }
    }
}
exports.default = OpenlitReplicateInstrumentation;
//# sourceMappingURL=index.js.map