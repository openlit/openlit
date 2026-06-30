"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitGoogleAIInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-google-ai`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@google/generative-ai', ['>=0.1.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(googleAI) {
        this._patch(googleAI);
    }
    _patch(moduleExports) {
        try {
            if ((0, instrumentation_1.isWrapped)(moduleExports.GenerativeModel.prototype.generateContent)) {
                this._unwrap(moduleExports.GenerativeModel.prototype, 'generateContent');
            }
            if ((0, instrumentation_1.isWrapped)(moduleExports.GenerativeModel.prototype.generateContentStream)) {
                this._unwrap(moduleExports.GenerativeModel.prototype, 'generateContentStream');
            }
            this._wrap(moduleExports.GenerativeModel.prototype, 'generateContent', wrapper_1.default._patchGenerateContent(this.tracer));
            this._wrap(moduleExports.GenerativeModel.prototype, 'generateContentStream', wrapper_1.default._patchGenerateContent(this.tracer));
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        this._unwrap(moduleExports.GenerativeModel.prototype, 'generateContent');
        this._unwrap(moduleExports.GenerativeModel.prototype, 'generateContentStream');
    }
}
exports.default = OpenlitGoogleAIInstrumentation;
//# sourceMappingURL=index.js.map