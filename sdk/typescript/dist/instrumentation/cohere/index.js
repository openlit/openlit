"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitCohereInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-cohere-ai`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('cohere-ai', ['>=7.2.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(cohere) {
        this._patch(cohere);
    }
    _patch(moduleExports) {
        try {
            if ((0, instrumentation_1.isWrapped)(moduleExports.CohereClient.prototype.embed)) {
                this._unwrap(moduleExports.CohereClient.prototype, 'embed');
            }
            if ((0, instrumentation_1.isWrapped)(moduleExports.CohereClient.prototype.chat)) {
                this._unwrap(moduleExports.CohereClient.prototype, 'chat');
            }
            if ((0, instrumentation_1.isWrapped)(moduleExports.CohereClient.prototype.chatStream)) {
                this._unwrap(moduleExports.CohereClient.prototype, 'chatStream');
            }
            this._wrap(moduleExports.CohereClient.prototype, 'embed', wrapper_1.default._patchEmbed(this.tracer));
            this._wrap(moduleExports.CohereClient.prototype, 'chat', wrapper_1.default._patchChat(this.tracer));
            this._wrap(moduleExports.CohereClient.prototype, 'chatStream', wrapper_1.default._patchChatStream(this.tracer));
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        this._unwrap(moduleExports.CohereClient.prototype, 'embed');
        this._unwrap(moduleExports.CohereClient.prototype, 'chat');
        this._unwrap(moduleExports.CohereClient.prototype, 'chatStream');
    }
}
exports.default = OpenlitCohereInstrumentation;
//# sourceMappingURL=index.js.map