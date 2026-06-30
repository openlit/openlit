"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitVertexAIInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-vertexai`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@google-cloud/vertexai', ['>=0.1.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(vertexAI) {
        this._patch(vertexAI);
    }
    _patch(moduleExports) {
        try {
            const GenerativeModel = moduleExports.GenerativeModel || moduleExports.GenerativeModelPreview;
            const ChatSession = moduleExports.ChatSession || moduleExports.ChatSessionPreview;
            if (GenerativeModel) {
                if ((0, instrumentation_1.isWrapped)(GenerativeModel.prototype.generateContent)) {
                    this._unwrap(GenerativeModel.prototype, 'generateContent');
                }
                if ((0, instrumentation_1.isWrapped)(GenerativeModel.prototype.generateContentStream)) {
                    this._unwrap(GenerativeModel.prototype, 'generateContentStream');
                }
                this._wrap(GenerativeModel.prototype, 'generateContent', wrapper_1.default._patchGenerateContent(this.tracer));
                this._wrap(GenerativeModel.prototype, 'generateContentStream', wrapper_1.default._patchGenerateContentStream(this.tracer));
            }
            if (ChatSession) {
                if ((0, instrumentation_1.isWrapped)(ChatSession.prototype.sendMessage)) {
                    this._unwrap(ChatSession.prototype, 'sendMessage');
                }
                if ((0, instrumentation_1.isWrapped)(ChatSession.prototype.sendMessageStream)) {
                    this._unwrap(ChatSession.prototype, 'sendMessageStream');
                }
                this._wrap(ChatSession.prototype, 'sendMessage', wrapper_1.default._patchSendMessage(this.tracer));
                this._wrap(ChatSession.prototype, 'sendMessageStream', wrapper_1.default._patchSendMessageStream(this.tracer));
            }
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        const GenerativeModel = moduleExports.GenerativeModel || moduleExports.GenerativeModelPreview;
        const ChatSession = moduleExports.ChatSession || moduleExports.ChatSessionPreview;
        if (GenerativeModel) {
            this._unwrap(GenerativeModel.prototype, 'generateContent');
            this._unwrap(GenerativeModel.prototype, 'generateContentStream');
        }
        if (ChatSession) {
            this._unwrap(ChatSession.prototype, 'sendMessage');
            this._unwrap(ChatSession.prototype, 'sendMessageStream');
        }
    }
}
exports.default = OpenlitVertexAIInstrumentation;
//# sourceMappingURL=index.js.map