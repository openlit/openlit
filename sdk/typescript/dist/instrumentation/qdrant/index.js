"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitQdrantInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-qdrant`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@qdrant/js-client-rest', ['>=1.0.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(qdrant) {
        this._patch(qdrant);
    }
    _patch(moduleExports) {
        try {
            const QdrantClient = moduleExports.QdrantClient;
            if (!QdrantClient?.prototype)
                return;
            const patchMap = [
                ['search', wrapper_1.default._patchSearch.bind(wrapper_1.default)],
                ['upsert', wrapper_1.default._patchUpsert.bind(wrapper_1.default)],
                ['delete', wrapper_1.default._patchDelete.bind(wrapper_1.default)],
                ['retrieve', wrapper_1.default._patchRetrieve.bind(wrapper_1.default)],
                ['scroll', wrapper_1.default._patchScroll.bind(wrapper_1.default)],
            ];
            for (const [method, patchFn] of patchMap) {
                if (typeof QdrantClient.prototype[method] === 'function') {
                    if ((0, instrumentation_1.isWrapped)(QdrantClient.prototype[method])) {
                        this._unwrap(QdrantClient.prototype, method);
                    }
                    this._wrap(QdrantClient.prototype, method, patchFn(this.tracer));
                }
            }
        }
        catch (e) {
            console.error('Error in Qdrant _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        try {
            const QdrantClient = moduleExports.QdrantClient;
            if (!QdrantClient?.prototype)
                return;
            for (const method of ['search', 'upsert', 'delete', 'retrieve', 'scroll']) {
                if (typeof QdrantClient.prototype[method] === 'function') {
                    this._unwrap(QdrantClient.prototype, method);
                }
            }
        }
        catch { /* ignore */ }
    }
}
exports.default = OpenlitQdrantInstrumentation;
//# sourceMappingURL=index.js.map