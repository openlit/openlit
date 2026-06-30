"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const wrapper_1 = __importDefault(require("../mistral/wrapper"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');
const mockTracer = api_1.trace.getTracer('test-tracer');
describe('MistralWrapper', () => {
    let span;
    beforeEach(() => {
        span = mockTracer.startSpan('test-span');
        span.setAttribute = jest.fn();
        span.addEvent = jest.fn();
        jest.clearAllMocks();
    });
    afterEach(() => {
        span.end();
    });
    describe('_chatCompletion', () => {
        it('should call recordMetrics after span ends', async () => {
            const mockArgs = [{ messages: [{ role: 'user', content: 'test message' }] }];
            const mockResponse = {
                id: '123',
                model: 'mistral-small-latest',
                usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
                choices: [
                    {
                        message: { content: 'response text', role: 'assistant' },
                        finish_reason: 'stop',
                    },
                ],
            };
            const mockGenAIEndpoint = 'mistral.chat.completions';
            jest
                .spyOn(wrapper_1.default, '_chatCompletionCommonSetter')
                .mockImplementationOnce(async ({ genAIEndpoint, span }) => {
                span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, 1);
                span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 100);
                span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.7);
                return {
                    genAIEndpoint,
                    model: 'mistral-small-latest',
                    user: 'test-user',
                    cost: 0.5,
                    aiSystem: semantic_convention_1.default.GEN_AI_SYSTEM_MISTRAL,
                };
            });
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: mockGenAIEndpoint,
                response: mockResponse,
                span,
            });
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalledWith(span, {
                genAIEndpoint: mockGenAIEndpoint,
                model: 'mistral-small-latest',
                user: 'test-user',
                cost: 0.5,
                aiSystem: semantic_convention_1.default.GEN_AI_SYSTEM_MISTRAL,
            });
        });
    });
    describe('_chatCompletionCommonSetter', () => {
        it('should set span attributes and return metric parameters', async () => {
            const mockArgs = [
                {
                    model: 'mistral-small-latest',
                    messages: [{ role: 'user', content: 'test message' }],
                    max_tokens: 100,
                    temperature: 0.7,
                    top_p: 1,
                    user: 'test-user',
                    presence_penalty: 2,
                    frequency_penalty: 3,
                    seed: 3,
                    stream: false,
                    stop: ['STOP'],
                },
            ];
            const mockResult = {
                id: '123',
                model: 'mistral-small-latest',
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 20,
                    total_tokens: 30,
                },
                choices: [
                    {
                        message: { content: 'response text', role: 'assistant' },
                        finish_reason: 'stop',
                    },
                ],
            };
            const mockGenAIEndpoint = 'mistral.chat.completions';
            jest.restoreAllMocks();
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0.5);
            const metricParams = await wrapper_1.default._chatCompletionCommonSetter({
                args: mockArgs,
                genAIEndpoint: mockGenAIEndpoint,
                result: mockResult,
                span,
            });
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, 1);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 100);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.7);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, 2);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, 3);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_SEED, 3);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, ['STOP']);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'mistral-small-latest');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 10);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
            expect(metricParams).toEqual({
                genAIEndpoint: mockGenAIEndpoint,
                model: 'mistral-small-latest',
                user: 'test-user',
                cost: 0.5,
                aiSystem: semantic_convention_1.default.GEN_AI_SYSTEM_MISTRAL,
            });
        });
        it('should NOT set sentinel values for optional request params', async () => {
            const mockArgs = [
                {
                    model: 'mistral-small-latest',
                    messages: [{ role: 'user', content: 'test' }],
                    stream: false,
                },
            ];
            const mockResult = {
                id: '456',
                model: 'mistral-small-latest',
                usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
                choices: [
                    {
                        message: { content: 'test response', role: 'assistant' },
                        finish_reason: 'stop',
                    },
                ],
            };
            jest.restoreAllMocks();
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            await wrapper_1.default._chatCompletionCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'mistral.chat.completions',
                result: mockResult,
                span,
            });
            const setAttrCalls = span.setAttribute.mock.calls;
            const attrKeys = setAttrCalls.map((c) => c[0]);
            expect(attrKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS);
            expect(attrKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_SEED);
            expect(attrKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY);
            expect(attrKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY);
            expect(attrKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES);
            expect(attrKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_CHOICE_COUNT);
        });
        it('should handle tool calls properly', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'test message' }],
                    tools: [{ type: 'function', function: { name: 'get_weather' } }],
                },
            ];
            const mockResult = {
                id: '123',
                model: 'mistral-small-latest',
                usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
                choices: [
                    {
                        message: {
                            content: null,
                            role: 'assistant',
                            tool_calls: [
                                {
                                    id: 'call_123',
                                    type: 'function',
                                    function: { name: 'get_weather', arguments: '{"location":"SF"}' },
                                },
                            ],
                        },
                        finish_reason: 'tool_calls',
                    },
                ],
            };
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0.5);
            await wrapper_1.default._chatCompletionCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'mistral.chat.completions',
                result: mockResult,
                span,
            });
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_NAME, 'get_weather');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, 'call_123');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_ARGS, '{"location":"SF"}');
        });
        it('should emit inference event when events not disabled', async () => {
            const mockArgs = [
                {
                    model: 'mistral-small-latest',
                    messages: [{ role: 'user', content: 'test message' }],
                    stream: false,
                },
            ];
            const mockResult = {
                id: '789',
                model: 'mistral-small-latest',
                usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
                choices: [
                    {
                        message: { content: 'response text', role: 'assistant' },
                        finish_reason: 'stop',
                    },
                ],
            };
            jest.restoreAllMocks();
            config_1.default.pricingInfo = {};
            config_1.default.captureMessageContent = false;
            config_1.default.disableEvents = false;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            jest.spyOn(helpers_1.default, 'emitInferenceEvent').mockImplementation(() => { });
            await wrapper_1.default._chatCompletionCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'mistral.chat.completions',
                result: mockResult,
                span,
            });
            expect(helpers_1.default.emitInferenceEvent).toHaveBeenCalledWith(span, expect.objectContaining({
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: 'mistral-small-latest',
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: 'mistral-small-latest',
                [semantic_convention_1.default.SERVER_ADDRESS]: 'api.mistral.ai',
                [semantic_convention_1.default.SERVER_PORT]: 443,
                [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: '789',
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: 10,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: 20,
            }));
        });
    });
    describe('Cross-Language Trace Comparison', () => {
        it('should use mistral_ai as provider name (matching Python SDK)', () => {
            expect(wrapper_1.default.aiSystem).toBe('mistral_ai');
            expect(wrapper_1.default.aiSystem).toBe(semantic_convention_1.default.GEN_AI_SYSTEM_MISTRAL);
        });
        it('should set same attributes as Python SDK for chat completion', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'What is Mistral AI?' }],
                    model: 'mistral-small-latest',
                    max_tokens: 50,
                    temperature: 0.7,
                    stream: false,
                },
            ];
            const mockResponse = {
                id: 'mistral-test-id',
                created: Date.now(),
                model: 'mistral-small-latest',
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: { role: 'assistant', content: 'Mistral AI is...' },
                    },
                ],
                usage: {
                    prompt_tokens: 8,
                    completion_tokens: 15,
                    total_tokens: 23,
                },
            };
            jest.restoreAllMocks();
            config_1.default.pricingInfo = {};
            config_1.default.captureMessageContent = true;
            config_1.default.disableEvents = true;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0.001);
            jest.spyOn(helpers_1.default, 'buildInputMessages').mockReturnValue('[]');
            jest.spyOn(helpers_1.default, 'buildOutputMessages').mockReturnValue('[]');
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'mistral.chat.completions',
                response: mockResponse,
                span,
            });
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 8);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 15);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'mistral-small-latest');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
            const setAttrCalls = span.setAttribute.mock.calls;
            const attrKeys = setAttrCalls.map((c) => c[0]);
            expect(attrKeys).not.toContain(semantic_convention_1.default.GEN_AI_USAGE_TOTAL_TOKENS);
            expect(attrKeys).not.toContain(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE);
        });
        it('should set embedding attributes matching Python SDK', async () => {
            const mockArgs = [
                {
                    model: 'mistral-embed',
                    input: 'Test embedding text',
                },
            ];
            const mockResponse = {
                model: 'mistral-embed',
                data: [{ embedding: [0.1, 0.2, 0.3] }],
                usage: {
                    prompt_tokens: 3,
                    total_tokens: 3,
                },
            };
            jest.restoreAllMocks();
            config_1.default.pricingInfo = {};
            config_1.default.captureMessageContent = true;
            jest.spyOn(helpers_1.default, 'getEmbedModelCost').mockReturnValue(0.0001);
            const mockTracer = {
                startSpan: jest.fn().mockReturnValue(span),
            };
            const patchMethod = wrapper_1.default._patchEmbedding(mockTracer);
            const wrappedMethod = patchMethod(async () => mockResponse);
            await wrappedMethod.call({}, ...mockArgs);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 3);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_ENCODING_FORMATS, ['float']);
            const setAttrCalls = span.setAttribute.mock.calls;
            const attrKeys = setAttrCalls.map((c) => c[0]);
            expect(attrKeys).not.toContain(semantic_convention_1.default.GEN_AI_SERVER_TTFT);
            expect(attrKeys).not.toContain(semantic_convention_1.default.GEN_AI_SERVER_TBT);
        });
    });
});
//# sourceMappingURL=mistral-trace-comparison.test.js.map