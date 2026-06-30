"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitPineconeInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-pinecone`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@pinecone-database/pinecone', ['>=1.0.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(pinecone) {
        this._patch(pinecone);
    }
    _patch(moduleExports) {
        try {
            // Patch Index prototype directly
            const IndexClass = moduleExports.Index;
            if (IndexClass?.prototype) {
                const methods = [
                    ['query', 'query'],
                    ['upsert', 'upsert'],
                    ['deleteOne', 'one'],
                    ['deleteMany', 'many'],
                    ['update', 'update'],
                ];
                for (const [method, opSuffix] of methods) {
                    if (typeof IndexClass.prototype[method] === 'function') {
                        if ((0, instrumentation_1.isWrapped)(IndexClass.prototype[method])) {
                            this._unwrap(IndexClass.prototype, method);
                        }
                        if (method === 'query') {
                            this._wrap(IndexClass.prototype, method, wrapper_1.default._patchQuery(this.tracer));
                        }
                        else if (method === 'upsert') {
                            this._wrap(IndexClass.prototype, method, wrapper_1.default._patchUpsert(this.tracer));
                        }
                        else if (method === 'update') {
                            this._wrap(IndexClass.prototype, method, wrapper_1.default._patchUpdate(this.tracer));
                        }
                        else {
                            this._wrap(IndexClass.prototype, method, wrapper_1.default._patchDelete(this.tracer, opSuffix));
                        }
                    }
                }
            }
        }
        catch (e) {
            console.error('Error in Pinecone _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        try {
            const IndexClass = moduleExports.Index;
            if (IndexClass?.prototype) {
                ['query', 'upsert', 'deleteOne', 'deleteMany', 'update'].forEach((method) => {
                    if (typeof IndexClass.prototype[method] === 'function') {
                        this._unwrap(IndexClass.prototype, method);
                    }
                });
            }
        }
        catch { /* ignore */ }
    }
}
exports.default = OpenlitPineconeInstrumentation;
//# sourceMappingURL=index.js.map