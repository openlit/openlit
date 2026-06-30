"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitMilvusInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-milvus`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@zilliz/milvus2-sdk-node', ['>=2.0.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(milvus) {
        this._patch(milvus);
    }
    _patch(moduleExports) {
        try {
            const MilvusClient = moduleExports.MilvusClient;
            if (!MilvusClient?.prototype)
                return;
            const patchMap = [
                ['search', wrapper_1.default._patchSearch.bind(wrapper_1.default)],
                ['insert', wrapper_1.default._patchInsert.bind(wrapper_1.default)],
                ['delete', wrapper_1.default._patchDelete.bind(wrapper_1.default)],
                ['query', wrapper_1.default._patchQuery.bind(wrapper_1.default)],
                ['upsert', wrapper_1.default._patchUpsert.bind(wrapper_1.default)],
            ];
            for (const [method, patchFn] of patchMap) {
                if (typeof MilvusClient.prototype[method] === 'function') {
                    if ((0, instrumentation_1.isWrapped)(MilvusClient.prototype[method])) {
                        this._unwrap(MilvusClient.prototype, method);
                    }
                    this._wrap(MilvusClient.prototype, method, patchFn(this.tracer));
                }
            }
        }
        catch (e) {
            console.error('Error in Milvus _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        try {
            const MilvusClient = moduleExports.MilvusClient;
            if (!MilvusClient?.prototype)
                return;
            for (const method of ['search', 'insert', 'delete', 'query', 'upsert']) {
                if (typeof MilvusClient.prototype[method] === 'function') {
                    this._unwrap(MilvusClient.prototype, method);
                }
            }
        }
        catch { /* ignore */ }
    }
}
exports.default = OpenlitMilvusInstrumentation;
//# sourceMappingURL=index.js.map