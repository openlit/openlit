"use strict";
/**
 * Cross-Language Trace Comparison Tests for Together AI Integration
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const wrapper_1 = __importDefault(require("../together/wrapper"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');
const mockTracer = api_1.trace.getTracer('test-tracer');
describe('Together AI Cross-Language Trace Comparison', () => {
    let span;
    beforeEach(() => {
        span = mockTracer.startSpan('test-span');
        span.setAttribute = jest.fn();
        span.addEvent = jest.fn();
        jest.clearAllMocks();
        config_1.default.environment = 'openlit-testing';
        config_1.default.applicationName = 'openlit-test';
        config_1.default.captureMessageContent = true;
        config_1.default.pricingInfo = {};
        config_1.default.disableEvents = false;
    });
    afterEach(() => {
        span.end();
    });
    describe('Chat Completion Trace Consistency', () => {
        it('should set same attributes as Python SDK', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'What is Together AI?' }],
                    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                    max_tokens: 50,
                    temperature: 0.7,
                    top_p: 0.9,
                    stream: false,
                },
            ];
            const mockResponse = {
                id: 'together-test-id',
                created: Date.now(),
                model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: { role: 'assistant', content: 'Together AI is...' },
                    },
                ],
                usage: {
                    prompt_tokens: 9,
                    completion_tokens: 12,
                    total_tokens: 21,
                },
            };
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0.001);
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'together.chat.completions',
                response: mockResponse,
                span,
            });
            // setBaseSpanAttributes is mocked; verify it was called with Together-specific params
            expect(base_wrapper_1.default.setBaseSpanAttributes).toHaveBeenCalledWith(span, expect.objectContaining({
                model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                aiSystem: 'together',
                serverAddress: 'api.together.xyz',
                serverPort: 443,
            }));
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 9);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 12);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_ID, 'together-test-id');
            expect(span.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_TOTAL_TOKENS, expect.anything());
            expect(span.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE, expect.anything());
        });
        it('should set request parameters correctly with no sentinel values', async () => {
            const mockArgs = [
                {
                    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                    messages: [{ role: 'user', content: 'test message' }],
                    max_tokens: 100,
                    temperature: 0.7,
                    top_p: 0.9,
                    presence_penalty: 0.5,
                    frequency_penalty: 0.3,
                    seed: 42,
                    stream: false,
                    stop: ['STOP'],
                    n: 2,
                },
            ];
            const mockResult = {
                id: 'test-123',
                model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
                choices: [
                    {
                        message: { content: 'response text', role: 'assistant' },
                        finish_reason: 'stop',
                    },
                ],
            };
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0.5);
            const metricParams = await wrapper_1.default._chatCompletionCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'together.chat.completions',
                result: mockResult,
                span,
            });
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, 0.9);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 100);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.7);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, 0.5);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, 0.3);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_SEED, 42);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, ['STOP']);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_CHOICE_COUNT, 2);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, 'text');
            expect(metricParams).toEqual({
                genAIEndpoint: 'together.chat.completions',
                model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                user: undefined,
                cost: 0.5,
                aiSystem: 'together',
            });
        });
        it('should not set sentinel values for optional attributes', async () => {
            const mockArgs = [
                {
                    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                    messages: [{ role: 'user', content: 'test' }],
                    stream: false,
                },
            ];
            const mockResult = {
                id: 'test-123',
                model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
                choices: [
                    {
                        message: { content: 'response', role: 'assistant' },
                        finish_reason: 'stop',
                    },
                ],
            };
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            await wrapper_1.default._chatCompletionCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'together.chat.completions',
                result: mockResult,
                span,
            });
            expect(span.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, -1);
            expect(span.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 0);
            expect(span.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_SEED, 0);
            expect(span.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_SEED, '');
            expect(span.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, 0);
            expect(span.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, 0);
            expect(span.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_CHOICE_COUNT, 1);
        });
        it('should handle tool calls properly', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'test message' }],
                    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                    tools: [{ type: 'function', function: { name: 'get_weather' } }],
                    stream: false,
                },
            ];
            const mockResult = {
                id: '123',
                model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
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
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0.5);
            await wrapper_1.default._chatCompletionCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'together.chat.completions',
                result: mockResult,
                span,
            });
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_NAME, 'get_weather');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, 'call_123');
            expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_ARGS, '{"location":"SF"}');
        });
        it('should emit inference event via LoggerProvider', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'Hello' }],
                    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                    stream: false,
                },
            ];
            const mockResult = {
                id: 'test-event-id',
                model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
                choices: [
                    {
                        message: { content: 'Hi there', role: 'assistant' },
                        finish_reason: 'stop',
                    },
                ],
            };
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            const emitSpy = jest.spyOn(helpers_1.default, 'emitInferenceEvent').mockImplementation();
            await wrapper_1.default._chatCompletionCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'together.chat.completions',
                result: mockResult,
                span,
            });
            expect(emitSpy).toHaveBeenCalledWith(span, expect.objectContaining({
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                [semantic_convention_1.default.SERVER_ADDRESS]: 'api.together.xyz',
                [semantic_convention_1.default.SERVER_PORT]: 443,
                [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: 'test-event-id',
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: 5,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: 10,
            }));
        });
        it('should call recordMetrics after span ends', async () => {
            const mockArgs = [{ messages: [{ role: 'user', content: 'test message' }], model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo' }];
            const mockResponse = {
                id: '123',
                model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
                choices: [
                    {
                        message: { content: 'response text', role: 'assistant' },
                        finish_reason: 'stop',
                    },
                ],
            };
            jest
                .spyOn(wrapper_1.default, '_chatCompletionCommonSetter')
                .mockImplementationOnce(async () => ({
                genAIEndpoint: 'together.chat.completions',
                model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                user: undefined,
                cost: 0.5,
                aiSystem: 'together',
            }));
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'together.chat.completions',
                response: mockResponse,
                span,
            });
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalledWith(span, {
                genAIEndpoint: 'together.chat.completions',
                model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
                user: undefined,
                cost: 0.5,
                aiSystem: 'together',
            });
        });
    });
});
//# sourceMappingURL=together-trace-comparison.test.js.map