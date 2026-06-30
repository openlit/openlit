"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const wrapper_1 = __importDefault(require("../openai/wrapper"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');
const mockTracer = api_1.trace.getTracer('test-tracer');
describe('OpenAIWrapper', () => {
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
                model: 'gpt-3.5-turbo',
                usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
                choices: [
                    {
                        message: { content: 'response text', role: 'assistant' },
                        finish_reason: 'stop',
                    },
                ],
            };
            const mockGenAIEndpoint = 'openai.resources.chat.completions';
            jest
                .spyOn(wrapper_1.default, '_chatCompletionCommonSetter')
                .mockImplementationOnce(async ({ genAIEndpoint, span }) => {
                span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, 1);
                span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 100);
                span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.7);
                return {
                    genAIEndpoint,
                    model: 'gpt-3.5-turbo',
                    user: 'test-user',
                    cost: 0.5,
                    aiSystem: 'openai',
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
                model: 'gpt-3.5-turbo',
                user: 'test-user',
                cost: 0.5,
                aiSystem: 'openai',
            });
        });
    });
    describe('_chatCompletionCommonSetter', () => {
        it('should set span attributes and return metric parameters', async () => {
            const mockArgs = [
                {
                    model: 'gpt-3.5-turbo',
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
                model: 'gpt-3.5-turbo',
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 20,
                    total_tokens: 30,
                    completion_tokens_details: { reasoning_tokens: 5 },
                },
                choices: [
                    {
                        message: { content: 'response text', role: 'assistant' },
                        finish_reason: 'stop',
                    },
                ],
                system_fingerprint: 'fp_test',
                service_tier: 'default',
            };
            const mockGenAIEndpoint = 'openai.resources.chat.completions';
            jest.restoreAllMocks();
            config_1.default.pricingInfo = {};
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0.5);
            const metricParams = await wrapper_1.default._chatCompletionCommonSetter({
                args: mockArgs,
                genAIEndpoint: mockGenAIEndpoint,
                result: mockResult,
                span,
            });
            // Basic request parameters
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, 1);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 100);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.7);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, 2);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, 3);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_SEED, 3);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            // New attributes
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, ['STOP']);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'gpt-3.5-turbo');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.OPENAI_RESPONSE_SYSTEM_FINGERPRINT, 'fp_test');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.OPENAI_RESPONSE_SERVICE_TIER, 'default');
            expect(metricParams).toEqual({
                genAIEndpoint: mockGenAIEndpoint,
                model: 'gpt-3.5-turbo',
                user: 'test-user',
                cost: 0.5,
                aiSystem: 'openai',
            });
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
                model: 'gpt-3.5-turbo',
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
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0.5);
            await wrapper_1.default._chatCompletionCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'openai.resources.chat.completions',
                result: mockResult,
                span,
            });
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_NAME, 'get_weather');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, 'call_123');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_ARGS, '{"location":"SF"}');
        });
    });
});
//# sourceMappingURL=openai-wrapper.test.js.map