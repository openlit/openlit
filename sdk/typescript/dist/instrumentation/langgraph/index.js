"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitLangGraphInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-langgraph`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@langchain/langgraph', ['>=0.0.31'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(langgraph) {
        this._patch(langgraph);
    }
    _patch(moduleExports) {
        try {
            const StateGraph = moduleExports.StateGraph;
            if (StateGraph?.prototype) {
                if (StateGraph.prototype.compile) {
                    if ((0, instrumentation_1.isWrapped)(StateGraph.prototype.compile)) {
                        this._unwrap(StateGraph.prototype, 'compile');
                    }
                    this._wrap(StateGraph.prototype, 'compile', wrapper_1.default._patchCompile(this.tracer));
                }
                if (StateGraph.prototype.addNode) {
                    if ((0, instrumentation_1.isWrapped)(StateGraph.prototype.addNode)) {
                        this._unwrap(StateGraph.prototype, 'addNode');
                    }
                    this._wrap(StateGraph.prototype, 'addNode', wrapper_1.default._patchAddNode(this.tracer));
                }
            }
            // Pregel is the compiled graph runtime — patch invoke and stream.
            // It may be exported directly or available on CompiledStateGraph.
            const Pregel = moduleExports.Pregel;
            if (Pregel?.prototype) {
                this._patchPregelProto(Pregel.prototype);
            }
            const CompiledStateGraph = moduleExports.CompiledStateGraph;
            if (CompiledStateGraph?.prototype) {
                this._patchPregelProto(CompiledStateGraph.prototype);
            }
        }
        catch { /* graceful degradation */ }
    }
    _patchPregelProto(proto) {
        if (proto.invoke) {
            if ((0, instrumentation_1.isWrapped)(proto.invoke)) {
                this._unwrap(proto, 'invoke');
            }
            this._wrap(proto, 'invoke', wrapper_1.default._patchInvoke(this.tracer));
        }
        if (proto.stream) {
            if ((0, instrumentation_1.isWrapped)(proto.stream)) {
                this._unwrap(proto, 'stream');
            }
            this._wrap(proto, 'stream', wrapper_1.default._patchStream(this.tracer));
        }
    }
    _unpatch(moduleExports) {
        try {
            const StateGraph = moduleExports.StateGraph;
            if (StateGraph?.prototype) {
                if ((0, instrumentation_1.isWrapped)(StateGraph.prototype.compile))
                    this._unwrap(StateGraph.prototype, 'compile');
                if ((0, instrumentation_1.isWrapped)(StateGraph.prototype.addNode))
                    this._unwrap(StateGraph.prototype, 'addNode');
            }
            const Pregel = moduleExports.Pregel;
            if (Pregel?.prototype) {
                if ((0, instrumentation_1.isWrapped)(Pregel.prototype.invoke))
                    this._unwrap(Pregel.prototype, 'invoke');
                if ((0, instrumentation_1.isWrapped)(Pregel.prototype.stream))
                    this._unwrap(Pregel.prototype, 'stream');
            }
            const CompiledStateGraph = moduleExports.CompiledStateGraph;
            if (CompiledStateGraph?.prototype) {
                if ((0, instrumentation_1.isWrapped)(CompiledStateGraph.prototype.invoke))
                    this._unwrap(CompiledStateGraph.prototype, 'invoke');
                if ((0, instrumentation_1.isWrapped)(CompiledStateGraph.prototype.stream))
                    this._unwrap(CompiledStateGraph.prototype, 'stream');
            }
        }
        catch { /* ignore */ }
    }
}
exports.default = OpenlitLangGraphInstrumentation;
//# sourceMappingURL=index.js.map