"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitAI21Instrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-ai21`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('ai21', ['>=1.0.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(ai21) {
        this._patch(ai21);
    }
    _patch(moduleExports) {
        try {
            // AI21 exposes chat completions as `Completions.prototype.create` (a flat
            // top-level export, unlike groq-sdk's nested `Groq.Chat.Completions`).
            // Note: ai21's CJS bundle does not re-export its classes, so under CommonJS
            // `moduleExports` is empty and the guard below makes this a safe no-op. The
            // patch takes effect when the SDK is loaded as ESM (OTel's import hook) or
            // when the module is supplied via `manualPatch`.
            if (!moduleExports?.Completions?.prototype?.create) {
                return;
            }
            if ((0, instrumentation_1.isWrapped)(moduleExports.Completions.prototype.create)) {
                this._unwrap(moduleExports.Completions.prototype, 'create');
            }
            this._wrap(moduleExports.Completions.prototype, 'create', wrapper_1.default._patchChatCompletionCreate(this.tracer));
            // Conversational RAG is exported as `ConversationalRag` from ai21 and maps
            // to `ConversationalRag.prototype.create` (mirrors the Python SDK's
            // StudioConversationalRag.create). Guarded the same way as Completions so
            // it is a safe no-op when the SDK is loaded as CommonJS.
            if (moduleExports?.ConversationalRag?.prototype?.create) {
                if ((0, instrumentation_1.isWrapped)(moduleExports.ConversationalRag.prototype.create)) {
                    this._unwrap(moduleExports.ConversationalRag.prototype, 'create');
                }
                this._wrap(moduleExports.ConversationalRag.prototype, 'create', wrapper_1.default._patchConversationalRagCreate(this.tracer));
            }
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        if (moduleExports?.Completions?.prototype?.create) {
            this._unwrap(moduleExports.Completions.prototype, 'create');
        }
        if (moduleExports?.ConversationalRag?.prototype?.create) {
            this._unwrap(moduleExports.ConversationalRag.prototype, 'create');
        }
    }
}
exports.default = OpenlitAI21Instrumentation;
//# sourceMappingURL=index.js.map