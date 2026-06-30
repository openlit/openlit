"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitHuggingFaceInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-huggingface`, '1.0.0', config);
        // Originals saved for unpatch (v4+)
        this._origTaskFns = {};
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@huggingface/inference', ['>=2.0.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(hf) {
        this._patch(hf);
    }
    _findLeafModule(namePart) {
        try {
            const cache = require.cache;
            const key = Object.keys(cache).find(k => k.includes('@huggingface') &&
                k.includes('inference') &&
                k.endsWith(`${namePart}.js`) &&
                !k.endsWith('Stream.js'));
            return key ? cache[key].exports : null;
        }
        catch {
            return null;
        }
    }
    _patch(moduleExports) {
        try {
            const tracer = this.tracer;
            // v4+: InferenceClient sets task methods as non-configurable own properties in
            // its constructor, capturing them from leaf task modules via a getter chain.
            // Patching the leaf modules (writable exports) propagates through the getters
            // so new instances capture the patched functions.
            const chatMod = this._findLeafModule('chatCompletion');
            if (chatMod && typeof chatMod.chatCompletion === 'function' && !chatMod.__openlit_hf_patched) {
                this._origTaskFns.chatCompletion = chatMod.chatCompletion;
                chatMod.chatCompletion = wrapper_1.default._patchChatCompletion(tracer)(chatMod.chatCompletion);
                chatMod.__openlit_hf_patched = true;
            }
            const textMod = this._findLeafModule('textGeneration');
            if (textMod && typeof textMod.textGeneration === 'function' && !textMod.__openlit_hf_patched) {
                this._origTaskFns.textGeneration = textMod.textGeneration;
                textMod.textGeneration = wrapper_1.default._patchTextGeneration(tracer)(textMod.textGeneration);
                textMod.__openlit_hf_patched = true;
            }
            // v2/v3: Methods on the prototype
            for (const ClassName of ['HfInference', 'InferenceClient']) {
                const proto = moduleExports[ClassName]?.prototype;
                if (!proto)
                    continue;
                if (typeof proto.chatCompletion === 'function') {
                    if ((0, instrumentation_1.isWrapped)(proto.chatCompletion))
                        this._unwrap(proto, 'chatCompletion');
                    this._wrap(proto, 'chatCompletion', wrapper_1.default._patchChatCompletion(tracer));
                }
                if (typeof proto.textGeneration === 'function') {
                    if ((0, instrumentation_1.isWrapped)(proto.textGeneration))
                        this._unwrap(proto, 'textGeneration');
                    this._wrap(proto, 'textGeneration', wrapper_1.default._patchTextGeneration(tracer));
                }
            }
        }
        catch (e) {
            console.error('Error in HuggingFace _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        try {
            // Restore leaf module originals (v4+)
            const chatMod = this._findLeafModule('chatCompletion');
            if (chatMod && this._origTaskFns.chatCompletion) {
                chatMod.chatCompletion = this._origTaskFns.chatCompletion;
                delete chatMod.__openlit_hf_patched;
            }
            const textMod = this._findLeafModule('textGeneration');
            if (textMod && this._origTaskFns.textGeneration) {
                textMod.textGeneration = this._origTaskFns.textGeneration;
                delete textMod.__openlit_hf_patched;
            }
            // Restore prototype methods (v2/v3)
            for (const ClassName of ['HfInference', 'InferenceClient']) {
                const proto = moduleExports[ClassName]?.prototype;
                if (!proto)
                    continue;
                if ((0, instrumentation_1.isWrapped)(proto.chatCompletion))
                    this._unwrap(proto, 'chatCompletion');
                if ((0, instrumentation_1.isWrapped)(proto.textGeneration))
                    this._unwrap(proto, 'textGeneration');
            }
        }
        catch { /* ignore */ }
    }
}
exports.default = OpenlitHuggingFaceInstrumentation;
//# sourceMappingURL=index.js.map