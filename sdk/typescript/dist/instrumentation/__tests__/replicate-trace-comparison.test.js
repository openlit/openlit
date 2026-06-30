"use strict";
/**
 * Trace Comparison Tests for Replicate Integration
 *
 * Verifies that the TypeScript SDK generates consistent traces for
 * Replicate model runs, aligned with OTel semantic conventions and
 * the OpenAI reference implementation pattern.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const wrapper_1 = __importDefault(require("../replicate/wrapper"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');
describe('Replicate Trace Comparison', () => {
    let mockSpan;
    beforeEach(() => {
        mockSpan = {
            setAttribute: jest.fn(),
            addEvent: jest.fn(),
            end: jest.fn(),
            setStatus: jest.fn(),
        };
        config_1.default.environment = 'openlit-testing';
        config_1.default.applicationName = 'openlit-test';
        config_1.default.captureMessageContent = true;
        config_1.default.pricingInfo = {};
        config_1.default.disableEvents = false;
        helpers_1.default.getChatModelCost = jest.fn().mockReturnValue(0.001);
        helpers_1.default.generalTokens = jest.fn().mockReturnValue(10);
        helpers_1.default.handleException = jest.fn();
        helpers_1.default.buildInputMessages = jest.fn().mockReturnValue('[{"role":"user","parts":[{"type":"text","content":"What is the capital of France?"}]}]');
        helpers_1.default.buildOutputMessages = jest.fn().mockReturnValue('[{"role":"assistant","parts":[{"type":"text","content":"Paris."}],"finish_reason":"stop"}]');
        helpers_1.default.emitInferenceEvent = jest.fn();
        base_wrapper_1.default.recordMetrics = jest.fn();
        base_wrapper_1.default.setBaseSpanAttributes = jest.fn().mockImplementation((span, attrs) => {
            span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, attrs.aiSystem);
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
    describe('run() — core attributes', () => {
        const identifier = 'meta/llama-2-70b-chat';
        const mockArgs = [
            identifier,
            { input: { prompt: 'What is the capital of France?' } },
        ];
        it('should set gen_ai.provider.name = "replicate"', async () => {
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Paris.',
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, 'replicate');
        });
        it('should set gen_ai.request.model stripped of version hash', async () => {
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Paris.',
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, 'meta/llama-2-70b-chat');
        });
        it('should strip version hash from identifier with colon', async () => {
            const argsWithVersion = [
                'stability-ai/sdxl:abc123def456',
                { input: { prompt: 'A sunset over mountains' } },
            ];
            await wrapper_1.default._run({
                args: argsWithVersion,
                genAIEndpoint: 'replicate.run',
                response: ['https://example.com/image.png'],
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, 'stability-ai/sdxl');
        });
        it('should set gen_ai.response.model', async () => {
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Paris.',
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'meta/llama-2-70b-chat');
        });
        it('should set gen_ai.request.is_stream = false', async () => {
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Paris.',
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
        });
        it('should set gen_ai.response.finish_reasons = ["stop"]', async () => {
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Paris.',
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
        });
        it('should set server.address and server.port', async () => {
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Paris.',
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_ADDRESS, 'api.replicate.com');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_PORT, 443);
        });
        it('should set token usage attributes', async () => {
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Paris.',
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 10);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 10);
        });
    });
    describe('run() — output types', () => {
        const mockArgs = [
            'meta/llama-2-70b-chat',
            { input: { prompt: 'What is the capital of France?' } },
        ];
        it('should set output_type=text for string responses', async () => {
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Paris.',
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
        });
        it('should set output_type=text for array responses (text chunks)', async () => {
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: ['Par', 'is', '.'],
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
        });
        it('should set output_type=json for object responses', async () => {
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: { answer: 'Paris', confidence: 0.99 },
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON);
        });
    });
    describe('run() — no sentinel values', () => {
        it('should NOT set total_tokens or client.token.usage on span', async () => {
            const mockArgs = [
                'meta/llama-2-70b-chat',
                { input: { prompt: 'Test' } },
            ];
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Response',
                span: mockSpan,
            });
            const setAttributeCalls = mockSpan.setAttribute.mock.calls;
            const attributeKeys = setAttributeCalls.map(([key]) => key);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_USAGE_TOTAL_TOKENS);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE);
        });
    });
    describe('run() — content capture', () => {
        const mockArgs = [
            'meta/llama-2-70b-chat',
            { input: { prompt: 'What is the capital of France?' } },
        ];
        it('should capture input/output messages when captureMessageContent=true', async () => {
            config_1.default.captureMessageContent = true;
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Paris.',
                span: mockSpan,
            });
            expect(helpers_1.default.buildInputMessages).toHaveBeenCalled();
            expect(helpers_1.default.buildOutputMessages).toHaveBeenCalled();
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, expect.any(String));
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, expect.any(String));
        });
        it('should NOT capture messages when captureMessageContent=false', async () => {
            config_1.default.captureMessageContent = false;
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Paris.',
                span: mockSpan,
            });
            const setAttributeCalls = mockSpan.setAttribute.mock.calls;
            const attributeKeys = setAttributeCalls.map(([key]) => key);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES);
        });
    });
    describe('run() — events', () => {
        const mockArgs = [
            'meta/llama-2-70b-chat',
            { input: { prompt: 'Test' } },
        ];
        it('should emit inference event via LoggerProvider', async () => {
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Response',
                span: mockSpan,
            });
            expect(helpers_1.default.emitInferenceEvent).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: 'meta/llama-2-70b-chat',
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: 'meta/llama-2-70b-chat',
                [semantic_convention_1.default.SERVER_ADDRESS]: 'api.replicate.com',
                [semantic_convention_1.default.SERVER_PORT]: 443,
                [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: ['stop'],
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: 10,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: 10,
            }));
        });
        it('should include message content in event when captureMessageContent=true', async () => {
            config_1.default.captureMessageContent = true;
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Response',
                span: mockSpan,
            });
            expect(helpers_1.default.emitInferenceEvent).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
                [semantic_convention_1.default.GEN_AI_INPUT_MESSAGES]: expect.any(String),
                [semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES]: expect.any(String),
            }));
        });
        it('should NOT include message content in event when captureMessageContent=false', async () => {
            config_1.default.captureMessageContent = false;
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Response',
                span: mockSpan,
            });
            const eventCall = helpers_1.default.emitInferenceEvent.mock.calls[0];
            const eventAttrs = eventCall[1];
            expect(eventAttrs).not.toHaveProperty(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES);
            expect(eventAttrs).not.toHaveProperty(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES);
        });
        it('should NOT emit events when disableEvents=true', async () => {
            config_1.default.disableEvents = true;
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Response',
                span: mockSpan,
            });
            expect(helpers_1.default.emitInferenceEvent).not.toHaveBeenCalled();
        });
    });
    describe('run() — metrics', () => {
        it('should record metrics via BaseWrapper.recordMetrics', async () => {
            const mockArgs = [
                'meta/llama-2-70b-chat',
                { input: { prompt: 'Test' } },
            ];
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Response',
                span: mockSpan,
            });
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
                genAIEndpoint: 'replicate.run',
                model: 'meta/llama-2-70b-chat',
                aiSystem: 'replicate',
            }));
        });
        it('should use OpenlitConfig.pricingInfo for cost calculation', async () => {
            config_1.default.pricingInfo = { chat: { 'meta/llama-2-70b-chat': { promptPrice: 0.05, completionPrice: 0.08 } } };
            const mockArgs = [
                'meta/llama-2-70b-chat',
                { input: { prompt: 'Test' } },
            ];
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Response',
                span: mockSpan,
            });
            expect(helpers_1.default.getChatModelCost).toHaveBeenCalledWith('meta/llama-2-70b-chat', expect.any(Object), 10, 10);
        });
        it('should end span and record metrics', async () => {
            const mockArgs = [
                'meta/llama-2-70b-chat',
                { input: { prompt: 'Test' } },
            ];
            await wrapper_1.default._run({
                args: mockArgs,
                genAIEndpoint: 'replicate.run',
                response: 'Response',
                span: mockSpan,
            });
            expect(mockSpan.end).toHaveBeenCalled();
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalled();
        });
    });
    describe('Span Creation Attributes', () => {
        it('should use aiSystem from SemanticConvention.GEN_AI_SYSTEM_REPLICATE', () => {
            expect(wrapper_1.default.aiSystem).toBe(semantic_convention_1.default.GEN_AI_SYSTEM_REPLICATE);
            expect(wrapper_1.default.aiSystem).toBe('replicate');
        });
        it('should set correct server address and port', () => {
            expect(wrapper_1.default.serverAddress).toBe('api.replicate.com');
            expect(wrapper_1.default.serverPort).toBe(443);
        });
    });
});
//# sourceMappingURL=replicate-trace-comparison.test.js.map