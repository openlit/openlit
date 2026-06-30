"use strict";
/**
 * Cross-Language Trace Comparison Tests for Google AI Studio Integration
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const wrapper_1 = __importDefault(require("../google-ai/wrapper"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');
const mockTracer = api_1.trace.getTracer('test-tracer');
describe('Google AI Studio Cross-Language Trace Comparison', () => {
    let mockSpan;
    beforeEach(() => {
        mockSpan = mockTracer.startSpan('test-span');
        mockSpan.setAttribute = jest.fn();
        mockSpan.addEvent = jest.fn();
        mockSpan.end = jest.fn();
        mockSpan.setStatus = jest.fn();
        config_1.default.environment = 'openlit-testing';
        config_1.default.applicationName = 'openlit-test';
        config_1.default.captureMessageContent = true;
        config_1.default.pricingInfo = {};
        config_1.default.disableEvents = false;
        helpers_1.default.getChatModelCost = jest.fn().mockReturnValue(0.001);
        helpers_1.default.handleException = jest.fn();
        helpers_1.default.createStreamProxy = jest.fn().mockImplementation((stream, _generator) => stream);
        helpers_1.default.buildInputMessages = jest.fn().mockReturnValue('[{"role":"user","parts":[{"type":"text","content":"What is Gemini?"}]}]');
        helpers_1.default.buildOutputMessages = jest.fn().mockReturnValue('[{"role":"assistant","parts":[{"type":"text","content":"Gemini is Google\'s AI model"}],"finish_reason":"STOP"}]');
        helpers_1.default.emitInferenceEvent = jest.fn();
        base_wrapper_1.default.recordMetrics = jest.fn();
        base_wrapper_1.default.setBaseSpanAttributes = jest.fn().mockImplementation((span, attrs) => {
            span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, attrs.aiSystem);
            span.setAttribute(semantic_convention_1.default.GEN_AI_ENDPOINT, attrs.genAIEndpoint);
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, attrs.model);
            if (attrs.cost !== undefined) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_COST, attrs.cost);
            }
            if (attrs.serverAddress) {
                span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, attrs.serverAddress);
            }
            if (attrs.serverPort !== undefined) {
                span.setAttribute(semantic_convention_1.default.SERVER_PORT, attrs.serverPort);
            }
            span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, '1.9.0');
        });
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    describe('Generate Content Trace Consistency', () => {
        it('should set same attributes as Python SDK', async () => {
            const mockArgs = [
                {
                    contents: [
                        { role: 'user', parts: [{ text: 'What is Gemini?' }] },
                    ],
                    config: {
                        temperature: 0.7,
                        maxOutputTokens: 100,
                        topP: 0.95,
                    },
                },
            ];
            const mockResponse = {
                response: {
                    modelVersion: 'gemini-pro',
                    text: () => "Gemini is Google's AI model",
                    candidates: [
                        {
                            content: {
                                parts: [{ text: "Gemini is Google's AI model" }],
                                role: 'model',
                            },
                            finishReason: 'STOP',
                        },
                    ],
                    usageMetadata: {
                        promptTokenCount: 5,
                        candidatesTokenCount: 10,
                        totalTokenCount: 15,
                    },
                },
            };
            await wrapper_1.default._generateContent({
                args: mockArgs,
                genAIEndpoint: 'google.generativeai.models.generate_content',
                response: mockResponse,
                span: mockSpan,
                requestModel: 'gemini-pro',
            });
            // Provider name: gcp.gemini (matches OTel semconv well-known value for Google AI Studio)
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, 'gcp.gemini');
            // Request model
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, 'gemini-pro');
            // Response model
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'gemini-pro');
            // Token usage
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 5);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 10);
            // Server address + port
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_ADDRESS, 'generativelanguage.googleapis.com');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_PORT, 443);
            // Request params from config
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.7);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 100);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, 0.95);
            // is_stream
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            // Finish reason as array
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['STOP']);
            // Output type
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, 'text');
        });
        it('should not set sentinel values for unset params', async () => {
            const mockArgs = [
                {
                    contents: 'Hello',
                    config: {},
                },
            ];
            const mockResponse = {
                response: {
                    text: () => 'Hi there!',
                    candidates: [{ content: { parts: [{ text: 'Hi there!' }], role: 'model' }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
                },
            };
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            await wrapper_1.default._generateContent({
                args: mockArgs,
                genAIEndpoint: 'google.generativeai.models.generate_content',
                response: mockResponse,
                span: mockSpan,
                requestModel: 'gemini-2.0-flash',
            });
            const setAttrCalls = mockSpan.setAttribute.mock.calls.map((c) => c[0]);
            expect(setAttrCalls).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE);
            expect(setAttrCalls).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS);
            expect(setAttrCalls).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P);
            expect(setAttrCalls).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_TOP_K);
            expect(setAttrCalls).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES);
        });
        it('should emit inference event independently of captureMessageContent', async () => {
            config_1.default.captureMessageContent = false;
            const mockArgs = [{ contents: 'Hello', config: {} }];
            const mockResponse = {
                response: {
                    text: () => 'Hi!',
                    candidates: [{ content: { parts: [{ text: 'Hi!' }], role: 'model' }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
                },
            };
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            await wrapper_1.default._generateContent({
                args: mockArgs,
                genAIEndpoint: 'google.generativeai.models.generate_content',
                response: mockResponse,
                span: mockSpan,
                requestModel: 'gemini-2.0-flash',
            });
            expect(helpers_1.default.emitInferenceEvent).toHaveBeenCalledTimes(1);
            const eventAttrs = helpers_1.default.emitInferenceEvent.mock.calls[0][1];
            expect(eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES]).toBeUndefined();
            expect(eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES]).toBeUndefined();
        });
        it('should call recordMetrics with cost from OpenlitConfig.pricingInfo', async () => {
            config_1.default.pricingInfo = { chat: { 'gemini-pro': { promptPrice: 0.1, completionPrice: 0.2 } } };
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0.0025);
            const mockArgs = [{ contents: 'test', config: {} }];
            const mockResponse = {
                response: {
                    modelVersion: 'gemini-pro',
                    text: () => 'response',
                    candidates: [{ content: { parts: [{ text: 'response' }], role: 'model' }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
                },
            };
            await wrapper_1.default._generateContent({
                args: mockArgs,
                genAIEndpoint: 'google.generativeai.models.generate_content',
                response: mockResponse,
                span: mockSpan,
                requestModel: 'gemini-pro',
            });
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
                model: 'gemini-pro',
                cost: 0.0025,
                aiSystem: 'gcp.gemini',
            }));
        });
        it('should handle function calls matching Python tool attributes', async () => {
            const mockArgs = [{ contents: 'What is the weather?', config: {} }];
            const mockResponse = {
                response: {
                    text: () => '',
                    candidates: [{
                            content: {
                                parts: [{
                                        functionCall: { name: 'get_weather', args: { location: 'NYC' } },
                                    }],
                                role: 'model',
                            },
                            finishReason: 'STOP',
                        }],
                    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8, totalTokenCount: 13 },
                },
            };
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            await wrapper_1.default._generateContent({
                args: mockArgs,
                genAIEndpoint: 'google.generativeai.models.generate_content',
                response: mockResponse,
                span: mockSpan,
                requestModel: 'gemini-2.0-flash',
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_NAME, 'get_weather');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_ARGS, '{"location":"NYC"}');
        });
    });
});
//# sourceMappingURL=google-ai-trace-comparison.test.js.map