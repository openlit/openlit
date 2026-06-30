"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitOllamaInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-ollama`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('ollama', ['>= 0.5.8'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(ollama) {
        this._patch(ollama);
    }
    _patch(moduleExports) {
        try {
            const proto = moduleExports.Ollama.prototype;
            if ((0, instrumentation_1.isWrapped)(proto.chat)) {
                this._unwrap(proto, 'chat');
            }
            this._wrap(proto, 'chat', wrapper_1.default._patchChat(this.tracer));
            if (typeof proto.generate === 'function') {
                if ((0, instrumentation_1.isWrapped)(proto.generate)) {
                    this._unwrap(proto, 'generate');
                }
                this._wrap(proto, 'generate', wrapper_1.default._patchGenerate(this.tracer));
            }
            if (typeof proto.embed === 'function') {
                if ((0, instrumentation_1.isWrapped)(proto.embed)) {
                    this._unwrap(proto, 'embed');
                }
                this._wrap(proto, 'embed', wrapper_1.default._patchEmbeddings(this.tracer));
            }
            if (typeof proto.embeddings === 'function') {
                if ((0, instrumentation_1.isWrapped)(proto.embeddings)) {
                    this._unwrap(proto, 'embeddings');
                }
                this._wrap(proto, 'embeddings', wrapper_1.default._patchEmbeddings(this.tracer));
            }
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        const proto = moduleExports.Ollama.prototype;
        this._unwrap(proto, 'chat');
        if (typeof proto.generate === 'function') {
            this._unwrap(proto, 'generate');
        }
        if (typeof proto.embed === 'function') {
            this._unwrap(proto, 'embed');
        }
        if (typeof proto.embeddings === 'function') {
            this._unwrap(proto, 'embeddings');
        }
    }
}
exports.default = OpenlitOllamaInstrumentation;
//# sourceMappingURL=index.js.map