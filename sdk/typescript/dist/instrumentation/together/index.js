"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitTogetherInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-together`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('together-ai', ['>=0.1.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(together) {
        this._patch(together);
    }
    _patch(moduleExports) {
        try {
            if ((0, instrumentation_1.isWrapped)(moduleExports.Together.Chat.Completions.prototype.create)) {
                this._unwrap(moduleExports.Together.Chat.Completions.prototype, 'create');
            }
            this._wrap(moduleExports.Together.Chat.Completions.prototype, 'create', wrapper_1.default._patchChatCompletionCreate(this.tracer));
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        this._unwrap(moduleExports.Together.Chat.Completions.prototype, 'create');
    }
}
exports.default = OpenlitTogetherInstrumentation;
//# sourceMappingURL=index.js.map