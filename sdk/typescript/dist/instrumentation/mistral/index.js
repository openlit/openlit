"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitMistralInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-mistral`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@mistralai/mistralai', ['>=1.0.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(mistral) {
        this._patch(mistral);
    }
    _patch(moduleExports) {
        try {
            // Chat and Embeddings are instance properties in the new SDK — get their
            // prototypes via a dummy instance (no API calls are made at construction time)
            const dummy = new moduleExports.Mistral({ apiKey: 'dummy' });
            const ChatProto = Object.getPrototypeOf(dummy.chat);
            const EmbeddingsProto = Object.getPrototypeOf(dummy.embeddings);
            if ((0, instrumentation_1.isWrapped)(ChatProto.complete)) {
                this._unwrap(ChatProto, 'complete');
            }
            if ((0, instrumentation_1.isWrapped)(ChatProto.stream)) {
                this._unwrap(ChatProto, 'stream');
            }
            if ((0, instrumentation_1.isWrapped)(EmbeddingsProto.create)) {
                this._unwrap(EmbeddingsProto, 'create');
            }
            this._wrap(ChatProto, 'complete', wrapper_1.default._patchChatCompletionCreate(this.tracer));
            this._wrap(ChatProto, 'stream', wrapper_1.default._patchChatCompletionCreate(this.tracer));
            this._wrap(EmbeddingsProto, 'create', wrapper_1.default._patchEmbedding(this.tracer));
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        try {
            const dummy = new moduleExports.Mistral({ apiKey: 'dummy' });
            const ChatProto = Object.getPrototypeOf(dummy.chat);
            const EmbeddingsProto = Object.getPrototypeOf(dummy.embeddings);
            this._unwrap(ChatProto, 'complete');
            this._unwrap(ChatProto, 'stream');
            this._unwrap(EmbeddingsProto, 'create');
        }
        catch (e) {
            console.error('Error in _unpatch method:', e);
        }
    }
}
exports.default = OpenlitMistralInstrumentation;
//# sourceMappingURL=index.js.map