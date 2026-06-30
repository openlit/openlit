"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const api_1 = require("@opentelemetry/api");
const constant_1 = require("../../constant");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitAstraInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-astra`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@datastax/astra-db-ts', ['>=1.0.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(astra) {
        this._patch(astra);
    }
    _patch(moduleExports) {
        try {
            const Collection = moduleExports.Collection;
            if (!Collection?.prototype)
                return;
            // `find` returns a cursor synchronously — must not be wrapped as async
            if (typeof Collection.prototype['find'] === 'function') {
                if ((0, instrumentation_1.isWrapped)(Collection.prototype['find'])) {
                    this._unwrap(Collection.prototype, 'find');
                }
                this._wrap(Collection.prototype, 'find', wrapper_1.default._patchSyncFindMethod(this.tracer));
            }
            // All other methods return Promises and use the async wrapper
            const asyncMethods = [
                ['insertOne', semantic_convention_1.default.DB_OPERATION_INSERT],
                ['insertMany', semantic_convention_1.default.DB_OPERATION_INSERT],
                ['updateOne', semantic_convention_1.default.DB_OPERATION_UPDATE],
                ['updateMany', semantic_convention_1.default.DB_OPERATION_UPDATE],
                ['replaceOne', semantic_convention_1.default.DB_OPERATION_REPLACE],
                ['findOne', semantic_convention_1.default.DB_OPERATION_SELECT],
                ['findOneAndUpdate', semantic_convention_1.default.DB_OPERATION_REPLACE],
                ['findOneAndReplace', semantic_convention_1.default.DB_OPERATION_REPLACE],
                ['findOneAndDelete', semantic_convention_1.default.DB_OPERATION_FIND_AND_DELETE],
                ['deleteOne', semantic_convention_1.default.DB_OPERATION_DELETE],
                ['deleteMany', semantic_convention_1.default.DB_OPERATION_DELETE],
            ];
            for (const [method, dbOp] of asyncMethods) {
                if (typeof Collection.prototype[method] === 'function') {
                    if ((0, instrumentation_1.isWrapped)(Collection.prototype[method])) {
                        this._unwrap(Collection.prototype, method);
                    }
                    this._wrap(Collection.prototype, method, wrapper_1.default._patchCollectionMethod(this.tracer, dbOp));
                }
            }
        }
        catch (e) {
            api_1.diag.error('Astra instrumentation: error in _patch method', e);
        }
    }
    _unpatch(moduleExports) {
        try {
            const Collection = moduleExports.Collection;
            if (!Collection?.prototype)
                return;
            for (const method of [
                'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne',
                'find', 'findOne', 'findOneAndUpdate', 'findOneAndReplace',
                'findOneAndDelete', 'deleteOne', 'deleteMany',
            ]) {
                if (typeof Collection.prototype[method] === 'function') {
                    this._unwrap(Collection.prototype, method);
                }
            }
        }
        catch { /* ignore */ }
    }
}
exports.default = OpenlitAstraInstrumentation;
//# sourceMappingURL=index.js.map