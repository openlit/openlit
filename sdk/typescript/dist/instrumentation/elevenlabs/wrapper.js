"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importStar(require("../../helpers"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
function spanCreationAttrs(operationName, requestModel, serverAddress, serverPort) {
    return {
        [semantic_convention_1.default.GEN_AI_OPERATION]: operationName,
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: ElevenLabsWrapper.aiSystem,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: serverPort,
    };
}
class ElevenLabsWrapper extends base_wrapper_1.default {
    static _parseAudioArgs(args) {
        const voiceId = typeof args[0] === 'string'
            ? args[0]
            : (args[0]?.voice_id || args[0]?.voiceId || '');
        const options = typeof args[0] === 'object' && args[0] !== null && typeof args[0] !== 'string'
            ? args[0]
            : (args[1] || {});
        const requestModel = options.modelId || options.model_id || options.model || 'eleven_multilingual_v2';
        const text = options.text || options.input || '';
        const voiceSettings = options.voiceSettings ?? options.voice_settings ?? '';
        const outputFormat = options.outputFormat || options.output_format || 'mp3_44100_128';
        return { voiceId, options, requestModel, text, voiceSettings, outputFormat };
    }
    static _patchConvert(tracer, methodName, sdkVersion) {
        const genAIEndpoint = `elevenlabs.textToSpeech.${methodName}`;
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const { requestModel } = ElevenLabsWrapper._parseAudioArgs(args);
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AUDIO} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AUDIO, requestModel, ElevenLabsWrapper.serverAddress, ElevenLabsWrapper.serverPort),
                }, effectiveCtx);
                return api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    let metricParams;
                    const startTime = Date.now();
                    try {
                        const response = await originalMethod.apply(this, args);
                        const ttft = (Date.now() - startTime) / 1000;
                        metricParams = ElevenLabsWrapper._commonAudioSetter({
                            args,
                            genAIEndpoint,
                            span,
                            ttft,
                            tbt: 0,
                            isStream: false,
                            sdkVersion,
                        });
                        return response;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint,
                            model: requestModel,
                            aiSystem: ElevenLabsWrapper.aiSystem,
                            serverAddress: ElevenLabsWrapper.serverAddress,
                            serverPort: ElevenLabsWrapper.serverPort,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
                        throw e;
                    }
                    finally {
                        span.end();
                        if (metricParams) {
                            base_wrapper_1.default.recordMetrics(span, metricParams);
                        }
                    }
                });
            };
        };
    }
    static _patchStream(tracer, methodName, sdkVersion) {
        const genAIEndpoint = `elevenlabs.textToSpeech.${methodName}`;
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const { requestModel } = ElevenLabsWrapper._parseAudioArgs(args);
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AUDIO} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AUDIO, requestModel, ElevenLabsWrapper.serverAddress, ElevenLabsWrapper.serverPort),
                }, effectiveCtx);
                return api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        return helpers_1.default.createStreamProxy(response, ElevenLabsWrapper._streamGenerator({
                            args,
                            genAIEndpoint,
                            response,
                            span,
                            sdkVersion,
                        }));
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint,
                            model: requestModel,
                            aiSystem: ElevenLabsWrapper.aiSystem,
                            serverAddress: ElevenLabsWrapper.serverAddress,
                            serverPort: ElevenLabsWrapper.serverPort,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
                        span.end();
                        throw e;
                    }
                });
            };
        };
    }
    static async *_streamGenerator({ args, genAIEndpoint, response, span, sdkVersion, }) {
        let metricParams;
        const timestamps = [];
        const startTime = Date.now();
        try {
            for await (const chunk of response) {
                timestamps.push(Date.now());
                yield chunk;
            }
            const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
            let tbt = 0;
            if (timestamps.length > 1) {
                const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
                tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
            }
            metricParams = ElevenLabsWrapper._commonAudioSetter({
                args,
                genAIEndpoint,
                span,
                ttft,
                tbt,
                isStream: true,
                sdkVersion,
            });
        }
        catch (e) {
            helpers_1.default.handleException(span, e);
            const { requestModel } = ElevenLabsWrapper._parseAudioArgs(args);
            base_wrapper_1.default.recordMetrics(span, {
                genAIEndpoint,
                model: requestModel,
                aiSystem: ElevenLabsWrapper.aiSystem,
                serverAddress: ElevenLabsWrapper.serverAddress,
                serverPort: ElevenLabsWrapper.serverPort,
                errorType: e?.constructor?.name || '_OTHER',
            });
            throw e;
        }
        finally {
            span.end();
            if (metricParams) {
                base_wrapper_1.default.recordMetrics(span, metricParams);
            }
        }
    }
    static _commonAudioSetter({ args, genAIEndpoint, span, ttft = 0, tbt = 0, isStream = false, sdkVersion, }) {
        const captureContent = config_1.default.captureMessageContent;
        const { voiceId, requestModel, text, voiceSettings, outputFormat, } = ElevenLabsWrapper._parseAudioArgs(args);
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_AUDIO_VOICE, voiceId);
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_AUDIO_SETTINGS, voiceSettings === '' || voiceSettings == null
            ? ''
            : typeof voiceSettings === 'object'
                ? JSON.stringify(voiceSettings)
                : String(voiceSettings));
        span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputFormat);
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, isStream);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 0);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 0);
        span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE, 0);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 0);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, 0);
        span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, tbt);
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = helpers_1.default.getAudioModelCost(requestModel, pricingInfo, text);
        ElevenLabsWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            cost,
            aiSystem: ElevenLabsWrapper.aiSystem,
            serverAddress: ElevenLabsWrapper.serverAddress,
            serverPort: ElevenLabsWrapper.serverPort,
        });
        // Python stamps gen_ai.system and the ElevenLabs package version (not OpenLIT's).
        span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME, ElevenLabsWrapper.aiSystem);
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, requestModel);
        if (sdkVersion) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, sdkVersion);
        }
        let inputMessagesJson;
        let outputMessagesJson;
        if (captureContent) {
            inputMessagesJson = helpers_1.default.buildInputMessages([{ role: 'user', content: text }]);
            outputMessagesJson = helpers_1.default.buildOutputMessages('[audio generated]', 'stop');
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
        }
        if (!config_1.default.disableEvents) {
            const eventAttrs = {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AUDIO,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: requestModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: ElevenLabsWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: ElevenLabsWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: outputFormat,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: 0,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: 0,
            };
            if (captureContent) {
                if (inputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
                if (outputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
            }
            helpers_1.default.emitInferenceEvent(span, eventAttrs);
        }
        return {
            genAIEndpoint,
            model: requestModel,
            cost,
            aiSystem: ElevenLabsWrapper.aiSystem,
            serverAddress: ElevenLabsWrapper.serverAddress,
            serverPort: ElevenLabsWrapper.serverPort,
        };
    }
}
ElevenLabsWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_ELEVENLABS;
ElevenLabsWrapper.serverAddress = 'api.elevenlabs.io';
ElevenLabsWrapper.serverPort = 443;
exports.default = ElevenLabsWrapper;
//# sourceMappingURL=wrapper.js.map