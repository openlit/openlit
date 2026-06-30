"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitGroqInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-groq`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('groq-sdk', ['>=0.5.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(groq) {
        this._patch(groq);
    }
    _patch(moduleExports) {
        try {
            if ((0, instrumentation_1.isWrapped)(moduleExports.Groq.Chat.Completions.prototype.create)) {
                this._unwrap(moduleExports.Groq.Chat.Completions.prototype, 'create');
            }
            this._wrap(moduleExports.Groq.Chat.Completions.prototype, 'create', wrapper_1.default._patchChatCompletionCreate(this.tracer));
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        this._unwrap(moduleExports.Groq.Chat.Completions.prototype, 'create');
    }
}
exports.default = OpenlitGroqInstrumentation;
//# sourceMappingURL=index.js.map