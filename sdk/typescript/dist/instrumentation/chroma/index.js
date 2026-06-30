"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitChromaInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-chroma`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('chromadb', ['>=1.5.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(chroma) {
        this._patch(chroma);
    }
    _patch(moduleExports) {
        try {
            const Collection = moduleExports.Collection;
            if (!Collection?.prototype)
                return;
            const methods = [
                ['add', semantic_convention_1.default.DB_OPERATION_INSERT],
                ['query', semantic_convention_1.default.DB_OPERATION_QUERY],
                ['get', semantic_convention_1.default.DB_OPERATION_GET],
                ['delete', semantic_convention_1.default.DB_OPERATION_DELETE],
                ['peek', semantic_convention_1.default.DB_OPERATION_PEEK],
                ['update', semantic_convention_1.default.DB_OPERATION_UPDATE],
                ['upsert', semantic_convention_1.default.DB_OPERATION_UPSERT],
            ];
            for (const [method, dbOp] of methods) {
                if (typeof Collection.prototype[method] === 'function') {
                    if ((0, instrumentation_1.isWrapped)(Collection.prototype[method])) {
                        this._unwrap(Collection.prototype, method);
                    }
                    this._wrap(Collection.prototype, method, wrapper_1.default._patchCollectionMethod(this.tracer, dbOp));
                }
            }
        }
        catch (e) {
            console.error('Error in Chroma _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        try {
            const Collection = moduleExports.Collection;
            if (!Collection?.prototype)
                return;
            for (const method of ['add', 'query', 'get', 'delete', 'peek', 'update', 'upsert']) {
                if (typeof Collection.prototype[method] === 'function') {
                    this._unwrap(Collection.prototype, method);
                }
            }
        }
        catch { /* ignore */ }
    }
}
exports.default = OpenlitChromaInstrumentation;
//# sourceMappingURL=index.js.map