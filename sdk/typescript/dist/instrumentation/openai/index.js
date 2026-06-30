"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitOpenAIInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-openai`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('openai', ['>=3.1.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(openai) {
        this._patch(openai);
    }
    _patch(moduleExports) {
        try {
            if ((0, instrumentation_1.isWrapped)(moduleExports.OpenAI.Chat.Completions.prototype.create)) {
                this._unwrap(moduleExports.OpenAI.Chat.Completions.prototype, 'create');
            }
            if ((0, instrumentation_1.isWrapped)(moduleExports.OpenAI.Embeddings.prototype.create)) {
                this._unwrap(moduleExports.OpenAI.Embeddings.prototype, 'create');
            }
            if ((0, instrumentation_1.isWrapped)(moduleExports.OpenAI.FineTuning.Jobs.prototype.create)) {
                this._unwrap(moduleExports.OpenAI.FineTuning.Jobs.prototype, 'create');
            }
            if ((0, instrumentation_1.isWrapped)(moduleExports.OpenAI.Images.prototype.generate)) {
                this._unwrap(moduleExports.OpenAI.Images.prototype, 'generate');
            }
            if ((0, instrumentation_1.isWrapped)(moduleExports.OpenAI.Images.prototype.createVariation)) {
                this._unwrap(moduleExports.OpenAI.Images.prototype, 'createVariation');
            }
            if ((0, instrumentation_1.isWrapped)(moduleExports.OpenAI.Audio.Speech.prototype)) {
                this._unwrap(moduleExports.OpenAI.Audio.Speech.prototype, 'create');
            }
            // Check if Responses API exists (OpenAI SDK >= 1.92.0)
            if (moduleExports.OpenAI.Responses && (0, instrumentation_1.isWrapped)(moduleExports.OpenAI.Responses.prototype.create)) {
                this._unwrap(moduleExports.OpenAI.Responses.prototype, 'create');
            }
            this._wrap(moduleExports.OpenAI.Chat.Completions.prototype, 'create', wrapper_1.default._patchChatCompletionCreate(this.tracer));
            this._wrap(moduleExports.OpenAI.Embeddings.prototype, 'create', wrapper_1.default._patchEmbedding(this.tracer));
            this._wrap(moduleExports.OpenAI.FineTuning.Jobs.prototype, 'create', wrapper_1.default._patchFineTune(this.tracer));
            this._wrap(moduleExports.OpenAI.Images.prototype, 'generate', wrapper_1.default._patchImageGenerate(this.tracer));
            this._wrap(moduleExports.OpenAI.Images.prototype, 'createVariation', wrapper_1.default._patchImageVariation(this.tracer));
            this._wrap(moduleExports.OpenAI.Audio.Speech.prototype, 'create', wrapper_1.default._patchAudioCreate(this.tracer));
            // Patch Responses API if available (OpenAI SDK >= 1.92.0)
            if (moduleExports.OpenAI.Responses) {
                this._wrap(moduleExports.OpenAI.Responses.prototype, 'create', wrapper_1.default._patchResponsesCreate(this.tracer));
            }
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        this._unwrap(moduleExports.OpenAI.Chat.Completions.prototype, 'create');
        this._unwrap(moduleExports.OpenAI.Embeddings.prototype, 'create');
        this._unwrap(moduleExports.OpenAI.FineTuning.prototype, 'jobs');
        this._unwrap(moduleExports.OpenAI.Images.prototype, 'generate');
        this._unwrap(moduleExports.OpenAI.Images.prototype, 'createVariation');
        this._unwrap(moduleExports.OpenAI.Audio.prototype, 'speech');
        if (moduleExports.OpenAI.Responses) {
            this._unwrap(moduleExports.OpenAI.Responses.prototype, 'create');
        }
    }
}
exports.default = OpenlitOpenAIInstrumentation;
//# sourceMappingURL=index.js.map