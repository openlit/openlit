"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitAnthropicInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-anthropic`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@anthropic-ai/sdk', ['>= 0.21.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(anthropic) {
        this._patch(anthropic);
    }
    _patch(moduleExports) {
        try {
            const AnthropicClass = moduleExports.Anthropic ?? moduleExports;
            if ((0, instrumentation_1.isWrapped)(AnthropicClass.Messages.prototype.create)) {
                this._unwrap(AnthropicClass.Messages.prototype, 'create');
            }
            this._wrap(AnthropicClass.Messages.prototype, 'create', wrapper_1.default._patchMessageCreate(this.tracer));
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        const AnthropicClass = moduleExports.Anthropic ?? moduleExports;
        this._unwrap(AnthropicClass.Messages.prototype, 'create');
    }
}
exports.default = OpenlitAnthropicInstrumentation;
//# sourceMappingURL=index.js.map