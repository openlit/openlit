"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const wrapper_1 = __importDefault(require("../elevenlabs/wrapper"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');
const mockTracer = api_1.trace.getTracer('test-tracer');
describe('ElevenLabsWrapper', () => {
    let span;
    beforeEach(() => {
        span = mockTracer.startSpan('test-span');
        span.setAttribute = jest.fn();
        span.addEvent = jest.fn();
        jest.clearAllMocks();
        helpers_1.default.buildInputMessages = jest
            .fn()
            .mockImplementation((messages) => JSON.stringify(messages.map((m) => ({
            role: m.role,
            parts: [{ type: 'text', content: m.content }],
        }))));
        helpers_1.default.buildOutputMessages = jest
            .fn()
            .mockImplementation((text, finishReason) => JSON.stringify([
            {
                role: 'assistant',
                parts: [{ type: 'text', content: text }],
                finish_reason: finishReason,
            },
        ]));
        base_wrapper_1.default.setBaseSpanAttributes = jest.fn();
    });
    afterEach(() => {
        span.end();
    });
    describe('_parseAudioArgs', () => {
        it('should parse voice id and options from positional args', () => {
            const parsed = wrapper_1.default._parseAudioArgs([
                'voice-id-123',
                {
                    text: 'Hello world',
                    model_id: 'eleven_turbo_v2',
                    voice_settings: { stability: 0.5 },
                    output_format: 'pcm_16000',
                },
            ]);
            expect(parsed).toEqual({
                voiceId: 'voice-id-123',
                options: {
                    text: 'Hello world',
                    model_id: 'eleven_turbo_v2',
                    voice_settings: { stability: 0.5 },
                    output_format: 'pcm_16000',
                },
                requestModel: 'eleven_turbo_v2',
                text: 'Hello world',
                voiceSettings: { stability: 0.5 },
                outputFormat: 'pcm_16000',
            });
        });
        it('should parse camelCase modelId from the official JS SDK', () => {
            const parsed = wrapper_1.default._parseAudioArgs([
                'voice-id-123',
                {
                    text: 'Hello',
                    modelId: 'eleven_turbo_v2_5',
                    voiceSettings: { stability: 0.5 },
                    outputFormat: 'mp3_44100_128',
                },
            ]);
            expect(parsed.requestModel).toBe('eleven_turbo_v2_5');
            expect(parsed.voiceSettings).toEqual({ stability: 0.5 });
            expect(parsed.outputFormat).toBe('mp3_44100_128');
        });
        it('should parse voice id and options from a single object arg', () => {
            const parsed = wrapper_1.default._parseAudioArgs([
                {
                    voice_id: 'voice-id-456',
                    text: 'Nested args',
                    model: 'eleven_monolingual_v1',
                },
            ]);
            expect(parsed.voiceId).toBe('voice-id-456');
            expect(parsed.requestModel).toBe('eleven_monolingual_v1');
            expect(parsed.text).toBe('Nested args');
        });
    });
    describe('_commonAudioSetter', () => {
        it('should set span attributes and return metric parameters', () => {
            const mockArgs = [
                'voice-id-123',
                {
                    text: 'Hello world',
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: { stability: 0.75, similarity_boost: 0.85 },
                    output_format: 'mp3_44100_128',
                },
            ];
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            config_1.default.captureMessageContent = true;
            jest.spyOn(helpers_1.default, 'getAudioModelCost').mockReturnValue(0.005);
            const metricParams = wrapper_1.default._commonAudioSetter({
                args: mockArgs,
                genAIEndpoint: 'elevenlabs.textToSpeech.convert',
                span,
                isStream: false,
            });
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_AUDIO_VOICE, 'voice-id-123');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_AUDIO_SETTINGS, JSON.stringify({ stability: 0.75, similarity_boost: 0.85 }));
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, 'mp3_44100_128');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 0);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 0);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE, 0);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 0);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, 0);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_SERVER_TTFT, 0);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_SERVER_TBT, 0);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_PROVIDER_NAME, 'elevenlabs');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'eleven_multilingual_v2');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'Hello world' }] }]));
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: '[audio generated]' }], finish_reason: 'stop' }]));
            expect(metricParams).toEqual({
                genAIEndpoint: 'elevenlabs.textToSpeech.convert',
                model: 'eleven_multilingual_v2',
                cost: 0.005,
                aiSystem: 'elevenlabs',
                serverAddress: 'api.elevenlabs.io',
                serverPort: 443,
            });
        });
        it('should stamp the ElevenLabs package version on the span', () => {
            const mockArgs = ['voice-id-123', { text: 'Hello world' }];
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            config_1.default.captureMessageContent = false;
            jest.spyOn(helpers_1.default, 'getAudioModelCost').mockReturnValue(0.005);
            wrapper_1.default._commonAudioSetter({
                args: mockArgs,
                genAIEndpoint: 'elevenlabs.textToSpeech.convert',
                span,
                isStream: false,
                sdkVersion: '2.54.0',
            });
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_SDK_VERSION, '2.54.0');
        });
        it('should not set message content if captureMessageContent is false', () => {
            const mockArgs = [
                'voice-id-123',
                {
                    text: 'Hello world',
                },
            ];
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            config_1.default.captureMessageContent = false;
            jest.spyOn(helpers_1.default, 'getAudioModelCost').mockReturnValue(0.005);
            wrapper_1.default._commonAudioSetter({
                args: mockArgs,
                genAIEndpoint: 'elevenlabs.textToSpeech.convert',
                span,
                isStream: false,
            });
            expect(span.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, expect.any(String));
            expect(span.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, expect.any(String));
        });
        it('should emit inference event if disableEvents is false', () => {
            const mockArgs = [
                'voice-id-123',
                {
                    text: 'Hello world',
                },
            ];
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = false;
            config_1.default.captureMessageContent = true;
            jest.spyOn(helpers_1.default, 'getAudioModelCost').mockReturnValue(0.005);
            const spyEmit = jest.spyOn(helpers_1.default, 'emitInferenceEvent');
            wrapper_1.default._commonAudioSetter({
                args: mockArgs,
                genAIEndpoint: 'elevenlabs.textToSpeech.convert',
                span,
                isStream: false,
            });
            expect(spyEmit).toHaveBeenCalledWith(span, expect.objectContaining({
                [semantic_convention_1.default.GEN_AI_OPERATION]: 'audio',
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: 'eleven_multilingual_v2',
            }));
        });
    });
    describe('_streamGenerator', () => {
        it('should yield chunks and call metric/setter methods', async () => {
            const mockArgs = [
                'voice-id-123',
                {
                    text: 'Hello world streaming',
                    model_id: 'eleven_multilingual_v2',
                },
            ];
            const mockResponse = (async function* () {
                yield Buffer.from('chunk1');
                yield Buffer.from('chunk2');
            })();
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            jest.spyOn(helpers_1.default, 'getAudioModelCost').mockReturnValue(0.005);
            jest.spyOn(wrapper_1.default, '_commonAudioSetter').mockReturnValue({
                genAIEndpoint: 'elevenlabs.textToSpeech.stream',
                model: 'eleven_multilingual_v2',
                cost: 0.005,
                aiSystem: 'elevenlabs',
            });
            const generator = wrapper_1.default._streamGenerator({
                args: mockArgs,
                genAIEndpoint: 'elevenlabs.textToSpeech.stream',
                response: mockResponse,
                span,
            });
            const chunks = [];
            for await (const chunk of generator) {
                chunks.push(chunk);
            }
            expect(chunks).toHaveLength(2);
            expect(wrapper_1.default._commonAudioSetter).toHaveBeenCalledWith(expect.objectContaining({
                args: mockArgs,
                genAIEndpoint: 'elevenlabs.textToSpeech.stream',
                span,
                isStream: true,
                ttft: expect.any(Number),
                tbt: expect.any(Number),
            }));
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalledWith(span, {
                genAIEndpoint: 'elevenlabs.textToSpeech.stream',
                model: 'eleven_multilingual_v2',
                cost: 0.005,
                aiSystem: 'elevenlabs',
            });
        });
        it('should record error metrics when streaming fails', async () => {
            const mockArgs = [
                'voice-id-123',
                {
                    text: 'Hello world streaming',
                    model_id: 'eleven_multilingual_v2',
                },
            ];
            const mockResponse = (async function* () {
                yield Buffer.from('chunk1');
                throw new Error('stream failed');
            })();
            const generator = wrapper_1.default._streamGenerator({
                args: mockArgs,
                genAIEndpoint: 'elevenlabs.textToSpeech.stream',
                response: mockResponse,
                span,
            });
            await expect(async () => {
                for await (const _chunk of generator) {
                    // consume until error
                }
            }).rejects.toThrow('stream failed');
            expect(helpers_1.default.handleException).toHaveBeenCalledWith(span, expect.any(Error));
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalledWith(span, {
                genAIEndpoint: 'elevenlabs.textToSpeech.stream',
                model: 'eleven_multilingual_v2',
                aiSystem: 'elevenlabs',
                serverAddress: 'api.elevenlabs.io',
                serverPort: 443,
                errorType: 'Error',
            });
        });
    });
});
//# sourceMappingURL=elevenlabs-wrapper.test.js.map