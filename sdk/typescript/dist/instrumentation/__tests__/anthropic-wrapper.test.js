"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const wrapper_1 = __importDefault(require("../anthropic/wrapper"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');
const mockTracer = api_1.trace.getTracer('test-tracer');
describe('AnthropicWrapper', () => {
    let span;
    beforeEach(() => {
        span = mockTracer.startSpan('test-span');
        span.setAttribute = jest.fn();
        jest.clearAllMocks();
    });
    afterEach(() => {
        span.end();
    });
    describe('_messageCreate', () => {
        it('should call recordMetrics after span ends', async () => {
            const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [{ role: 'user', content: 'test' }] }];
            const mockResponse = {
                id: 'msg_123',
                model: 'claude-3-5-sonnet-latest',
                content: [{ type: 'text', text: 'Hello' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 10, output_tokens: 20 },
            };
            jest.spyOn(base_wrapper_1.default, 'recordMetrics').mockImplementation(() => { });
            jest.spyOn(wrapper_1.default, '_messageCreateCommonSetter').mockImplementationOnce(async ({ genAIEndpoint, span }) => {
                span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, 'msg_123');
                span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 100);
                span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.7);
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 10);
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
                span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
                return {
                    genAIEndpoint,
                    model: 'claude-3-5-sonnet-latest',
                    user: undefined,
                    cost: 0.5,
                    aiSystem: 'anthropic',
                };
            });
            await wrapper_1.default._messageCreate({
                args: mockArgs,
                genAIEndpoint: 'anthropic.resources.messages',
                response: mockResponse,
                span,
            });
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalledWith(span, {
                model: 'claude-3-5-sonnet-latest',
                user: undefined,
                cost: 0.5,
                aiSystem: 'anthropic',
                genAIEndpoint: 'anthropic.resources.messages',
            });
        });
        it('should re-throw errors from commonSetter', async () => {
            const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [] }];
            const mockResponse = {};
            jest.spyOn(base_wrapper_1.default, 'recordMetrics').mockImplementation(() => { });
            jest.spyOn(wrapper_1.default, '_messageCreateCommonSetter').mockRejectedValueOnce(new Error('test error'));
            await expect(wrapper_1.default._messageCreate({
                args: mockArgs,
                genAIEndpoint: 'anthropic.resources.messages',
                response: mockResponse,
                span,
            })).rejects.toThrow('test error');
        });
    });
    describe('_messageCreateCommonSetter', () => {
        it('should set span attributes and return metric parameters', async () => {
            const mockArgs = [{
                    model: 'claude-3-5-sonnet-latest',
                    messages: [{ role: 'user', content: 'test message' }],
                    max_tokens: 100,
                    temperature: 0.7,
                }];
            const mockResult = {
                id: 'msg_123',
                usage: { input_tokens: 10, output_tokens: 20 },
                model: 'claude-3-5-sonnet-20241022',
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'Hello' }],
            };
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0.5);
            const setAttributeSpy = jest.spyOn(span, 'setAttribute');
            const metricParams = await wrapper_1.default._messageCreateCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'anthropic.resources.messages',
                result: mockResult,
                span,
            });
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_ID, 'msg_123');
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 100);
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.7);
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 10);
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'claude-3-5-sonnet-20241022');
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, 'text');
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            expect(setAttributeSpy).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_TOTAL_TOKENS, expect.anything());
            expect(metricParams).toEqual({
                genAIEndpoint: 'anthropic.resources.messages',
                model: 'claude-3-5-sonnet-latest',
                user: undefined,
                cost: 0.5,
                aiSystem: 'anthropic',
            });
        });
        it('should map Anthropic finish reasons to OTel standard', async () => {
            const makeResult = (stop_reason) => ({
                id: 'msg_1',
                usage: { input_tokens: 5, output_tokens: 5 },
                model: 'claude-3-5-sonnet-latest',
                stop_reason,
                content: [{ type: 'text', text: 'hi' }],
            });
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            const testCases = [
                { anthropic: 'end_turn', otel: 'stop' },
                { anthropic: 'max_tokens', otel: 'length' },
                { anthropic: 'stop_sequence', otel: 'stop' },
                { anthropic: 'tool_use', otel: 'tool_call' },
            ];
            for (const { anthropic, otel } of testCases) {
                jest.clearAllMocks();
                span.setAttribute = jest.fn();
                await wrapper_1.default._messageCreateCommonSetter({
                    args: [{ model: 'claude-3-5-sonnet-latest', messages: [] }],
                    genAIEndpoint: 'anthropic.resources.messages',
                    result: makeResult(anthropic),
                    span,
                });
                expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [otel]);
            }
        });
        it('should not set max_tokens when not provided', async () => {
            const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [], temperature: 1 }];
            const mockResult = {
                id: 'msg_1',
                usage: { input_tokens: 5, output_tokens: 5 },
                model: 'claude-3-5-sonnet-latest',
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'hi' }],
            };
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            const setAttributeSpy = jest.spyOn(span, 'setAttribute');
            await wrapper_1.default._messageCreateCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'anthropic.resources.messages',
                result: mockResult,
                span,
            });
            expect(setAttributeSpy).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, expect.anything());
        });
        it('should not set seed when not provided', async () => {
            const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [] }];
            const mockResult = {
                id: 'msg_1',
                usage: { input_tokens: 5, output_tokens: 5 },
                model: 'claude-3-5-sonnet-latest',
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'hi' }],
            };
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            const setAttributeSpy = jest.spyOn(span, 'setAttribute');
            await wrapper_1.default._messageCreateCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'anthropic.resources.messages',
                result: mockResult,
                span,
            });
            expect(setAttributeSpy).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_SEED, expect.anything());
        });
        it('should emit inference event when events are enabled', async () => {
            const mockArgs = [{
                    model: 'claude-3-5-sonnet-latest',
                    messages: [{ role: 'user', content: 'hello' }],
                }];
            const mockResult = {
                id: 'msg_123',
                usage: { input_tokens: 10, output_tokens: 20 },
                model: 'claude-3-5-sonnet-latest',
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'Hi there' }],
            };
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = false;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0.5);
            const emitSpy = jest.spyOn(helpers_1.default, 'emitInferenceEvent').mockImplementation(() => { });
            await wrapper_1.default._messageCreateCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'anthropic.resources.messages',
                result: mockResult,
                span,
            });
            expect(emitSpy).toHaveBeenCalledWith(span, expect.objectContaining({
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: 'claude-3-5-sonnet-latest',
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: 'claude-3-5-sonnet-latest',
                [semantic_convention_1.default.SERVER_ADDRESS]: 'api.anthropic.com',
                [semantic_convention_1.default.SERVER_PORT]: 443,
                [semantic_convention_1.default.GEN_AI_RESPONSE_ID]: 'msg_123',
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: ['stop'],
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: 'text',
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: 10,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: 20,
            }));
        });
        it('should set tool call attributes when tool_use blocks are present', async () => {
            const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [] }];
            const mockResult = {
                id: 'msg_1',
                usage: { input_tokens: 10, output_tokens: 20 },
                model: 'claude-3-5-sonnet-latest',
                stop_reason: 'tool_use',
                content: [
                    { type: 'text', text: '' },
                    { type: 'tool_use', id: 'toolu_123', name: 'get_weather', input: { location: 'Paris' } },
                ],
            };
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            const setAttributeSpy = jest.spyOn(span, 'setAttribute');
            await wrapper_1.default._messageCreateCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'anthropic.resources.messages',
                result: mockResult,
                span,
            });
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, 'json');
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_NAME, 'get_weather');
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, 'toolu_123');
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['tool_call']);
        });
        it('should set cache token attributes when present', async () => {
            const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [] }];
            const mockResult = {
                id: 'msg_1',
                usage: {
                    input_tokens: 10,
                    output_tokens: 20,
                    cache_creation_input_tokens: 5,
                    cache_read_input_tokens: 3,
                },
                model: 'claude-3-5-sonnet-latest',
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'cached response' }],
            };
            config_1.default.pricingInfo = {};
            config_1.default.disableEvents = true;
            jest.spyOn(helpers_1.default, 'getChatModelCost').mockReturnValue(0);
            const setAttributeSpy = jest.spyOn(span, 'setAttribute');
            await wrapper_1.default._messageCreateCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'anthropic.resources.messages',
                result: mockResult,
                span,
            });
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, 5);
            expect(setAttributeSpy).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 3);
        });
    });
});
//# sourceMappingURL=anthropic-wrapper.test.js.map