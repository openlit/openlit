"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const api_1 = require("@opentelemetry/api");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitElevenLabsInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-elevenlabs`, '1.0.0', config);
        this._textToSpeechProto = null;
    }
    init() {
        const elevenlabsModule = new instrumentation_1.InstrumentationNodeModuleDefinition('elevenlabs', ['>=1.4.0'], (moduleExports, moduleVersion) => {
            this._patch(moduleExports, moduleVersion);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        const elevenlabsJsModule = new instrumentation_1.InstrumentationNodeModuleDefinition('@elevenlabs/elevenlabs-js', ['>=1.0.0'], (moduleExports, moduleVersion) => {
            this._patch(moduleExports, moduleVersion);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [elevenlabsModule, elevenlabsJsModule];
    }
    manualPatch(elevenlabs) {
        this._patch(elevenlabs);
    }
    _patch(moduleExports, moduleVersion) {
        try {
            const OriginalElevenLabsClient = moduleExports.ElevenLabsClient;
            if (!OriginalElevenLabsClient || typeof OriginalElevenLabsClient !== 'function') {
                return;
            }
            if ((0, instrumentation_1.isWrapped)(OriginalElevenLabsClient)) {
                this._unwrap(moduleExports, 'ElevenLabsClient');
            }
            const tracer = this.tracer;
            const sdkVersion = moduleVersion ? String(moduleVersion) : undefined;
            this._wrap(moduleExports, 'ElevenLabsClient', (original) => {
                return (...clientArgs) => {
                    const client = new original(...clientArgs);
                    if (client && client.textToSpeech) {
                        const textToSpeechProto = Object.getPrototypeOf(client.textToSpeech);
                        if (textToSpeechProto) {
                            this._textToSpeechProto = textToSpeechProto;
                            if (textToSpeechProto.convert && !(0, instrumentation_1.isWrapped)(textToSpeechProto.convert)) {
                                this._wrap(textToSpeechProto, 'convert', wrapper_1.default._patchConvert(tracer, 'convert', sdkVersion));
                            }
                            if (textToSpeechProto.stream && !(0, instrumentation_1.isWrapped)(textToSpeechProto.stream)) {
                                this._wrap(textToSpeechProto, 'stream', wrapper_1.default._patchStream(tracer, 'stream', sdkVersion));
                            }
                            if (textToSpeechProto.convertWithTimestamps && !(0, instrumentation_1.isWrapped)(textToSpeechProto.convertWithTimestamps)) {
                                this._wrap(textToSpeechProto, 'convertWithTimestamps', wrapper_1.default._patchConvert(tracer, 'convertWithTimestamps', sdkVersion));
                            }
                        }
                    }
                    return client;
                };
            });
        }
        catch (e) {
            api_1.diag.error('elevenlabs instrumentation: error in _patch method', e);
        }
    }
    _unpatch(moduleExports) {
        if (moduleExports.ElevenLabsClient) {
            this._unwrap(moduleExports, 'ElevenLabsClient');
        }
        if (this._textToSpeechProto) {
            if ((0, instrumentation_1.isWrapped)(this._textToSpeechProto.convert)) {
                this._unwrap(this._textToSpeechProto, 'convert');
            }
            if ((0, instrumentation_1.isWrapped)(this._textToSpeechProto.stream)) {
                this._unwrap(this._textToSpeechProto, 'stream');
            }
            if ((0, instrumentation_1.isWrapped)(this._textToSpeechProto.convertWithTimestamps)) {
                this._unwrap(this._textToSpeechProto, 'convertWithTimestamps');
            }
        }
    }
}
exports.default = OpenlitElevenLabsInstrumentation;
//# sourceMappingURL=index.js.map