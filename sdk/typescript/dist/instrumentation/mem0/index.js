"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const api_1 = require("@opentelemetry/api");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
/**
 * mem0 method name -> span name. Span names reuse the Python endpoint strings
 * (snake_case `get_all` / `delete_all`) so TS and Python emit identical span names,
 * even though the JS methods are camelCase (`getAll` / `deleteAll`).
 */
const MEM0_METHODS = [
    ['add', 'memory add'],
    ['search', 'memory search'],
    ['get', 'memory get'],
    ['getAll', 'memory get_all'],
    ['update', 'memory update'],
    ['delete', 'memory delete'],
    ['deleteAll', 'memory delete_all'],
    ['history', 'memory history'],
    ['reset', 'memory reset'],
];
class OpenlitMem0Instrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-mem0`, '1.0.0', config);
    }
    init() {
        // mem0ai ships two clients at two specifiers:
        //   - `mem0ai`       -> hosted MemoryClient (the package entry, patched below)
        //   - `mem0ai/oss`   -> self-hosted Memory (an internal file)
        // require-in-the-middle reaches internal files via the `files` array, so the OSS
        // entry is registered as InstrumentationNodeModuleFile(s) on the main definition.
        // A few candidate paths are listed to stay robust across build layouts.
        const ossFiles = ['mem0ai/dist/oss/index.js', 'mem0ai/dist/oss/index.cjs', 'mem0ai/oss/index.js'].map((filePath) => new instrumentation_1.InstrumentationNodeModuleFile(filePath, ['>=0.1.32'], (moduleExports, moduleVersion) => {
            this._patchOss(moduleExports, moduleVersion);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined)
                this._unpatchOss(moduleExports);
        }));
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('mem0ai', ['>=0.1.32'], (moduleExports, moduleVersion) => {
            this._patch(moduleExports, moduleVersion);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined)
                this._unpatch(moduleExports);
        }, ossFiles);
        return [module];
    }
    manualPatch(mem0) {
        // Manual entry point (openlit.init({ instrumentations: { mem0 } })). The caller may
        // pass either the hosted module/class or the OSS one, so try both resolvers — the
        // isWrapped guard in _patchClass keeps it idempotent.
        this._patch(mem0);
        this._patchOss(mem0);
    }
    /** Patch the hosted MemoryClient (default export of `mem0ai`). */
    _patch(moduleExports, moduleVersion) {
        const ClientClass = moduleExports?.MemoryClient ?? moduleExports?.default ?? moduleExports;
        this._patchClass(ClientClass, moduleVersion);
    }
    /** Patch the self-hosted Memory class (`mem0ai/oss`). */
    _patchOss(moduleExports, moduleVersion) {
        const MemoryClass = moduleExports?.Memory ?? moduleExports?.default ?? moduleExports;
        this._patchClass(MemoryClass, moduleVersion);
    }
    _patchClass(target, moduleVersion) {
        try {
            const proto = target?.prototype;
            if (!proto)
                return;
            for (const [method, spanName] of MEM0_METHODS) {
                if (typeof proto[method] !== 'function')
                    continue;
                if ((0, instrumentation_1.isWrapped)(proto[method])) {
                    this._unwrap(proto, method);
                }
                this._wrap(proto, method, wrapper_1.default._patchMemoryOperation(this.tracer, spanName, moduleVersion));
            }
        }
        catch (e) {
            api_1.diag.error('mem0 instrumentation: error in _patch method', e);
        }
    }
    _unpatch(moduleExports) {
        const ClientClass = moduleExports?.MemoryClient ?? moduleExports?.default ?? moduleExports;
        this._unpatchClass(ClientClass);
    }
    _unpatchOss(moduleExports) {
        const MemoryClass = moduleExports?.Memory ?? moduleExports?.default ?? moduleExports;
        this._unpatchClass(MemoryClass);
    }
    _unpatchClass(target) {
        try {
            const proto = target?.prototype;
            if (!proto)
                return;
            for (const [method] of MEM0_METHODS) {
                if (typeof proto[method] === 'function' && (0, instrumentation_1.isWrapped)(proto[method])) {
                    this._unwrap(proto, method);
                }
            }
        }
        catch {
            /* ignore */
        }
    }
}
exports.default = OpenlitMem0Instrumentation;
//# sourceMappingURL=index.js.map