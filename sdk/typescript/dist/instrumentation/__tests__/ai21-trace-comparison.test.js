"use strict";
/**
 * Cross-Language Trace Comparison Tests for the AI21 Integration
 *
 * These verify that the TypeScript AI21 instrumentation emits the same span
 * attributes / events as the Python SDK reference
 * (sdk/python/src/openlit/instrumentation/ai21). AI21's request surface has no
 * seed / frequency_penalty / presence_penalty, and its responses carry no
 * `model` field, so the response model falls back to the request model.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const wrapper_1 = __importDefault(require("../ai21/wrapper"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');
describe('AI21 Cross-Language Trace Comparison', () => {
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
        helpers_1.default.openaiTokens = jest.fn().mockReturnValue(5);
        helpers_1.default.handleException = jest.fn();
        helpers_1.default.createStreamProxy = jest
            .fn()
            .mockImplementation((stream, _generator) => stream);
        helpers_1.default.buildInputMessages = jest
            .fn()
            .mockReturnValue('[{"role":"user","parts":[{"type":"text","content":"Test"}]}]');
        helpers_1.default.buildOutputMessages = jest
            .fn()
            .mockReturnValue('[{"role":"assistant","parts":[{"type":"text","content":"Response"}],"finish_reason":"stop"}]');
        helpers_1.default.buildSystemInstructionsFromMessages = jest
            .fn()
            .mockImplementation((messages) => {
            const sys = (messages || []).find((m) => m?.role === 'system');
            return sys ? JSON.stringify([{ type: 'text', content: String(sys.content) }]) : undefined;
        });
        helpers_1.default.buildToolDefinitions = jest.fn().mockReturnValue(undefined);
        helpers_1.default.emitInferenceEvent = jest.fn();
        helpers_1.default.computeAgentVersionHash = jest
            .fn()
            .mockReturnValue('ts-test-version-hash');
        base_wrapper_1.default.recordMetrics = jest.fn();
        base_wrapper_1.default.setBaseSpanAttributes = jest
            .fn()
            .mockImplementation((span, attrs) => {
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
    // AI21 ChatCompletionResponse shape: no `model`, OpenAI-compatible choices/usage.
    const mockResponse = () => ({
        id: 'ai21-test-id',
        choices: [
            { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Jamba says hi' } },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    describe('Chat Completion Trace Consistency', () => {
        it('should set the same core attributes as the Python SDK', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'What is LLM Observability?' }],
                    model: 'jamba-large',
                    max_tokens: 100,
                    temperature: 0.7,
                    stream: false,
                },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'ai21.chat.completions',
                response: mockResponse(),
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, 'ai21');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, 'jamba-large');
            // AI21 responses carry no `model`, so it falls back to the request model.
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'jamba-large');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_ID, 'ai21-test-id');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 10);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.7);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 100);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, 'text');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_ADDRESS, 'api.ai21.com');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_PORT, 443);
        });
        it('stamps openlit.agent.version_hash on the chat span', async () => {
            const mockArgs = [
                { messages: [{ role: 'user', content: 'Hash me' }], model: 'jamba-mini', stream: false },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'ai21.chat.completions',
                response: mockResponse(),
                span: mockSpan,
            });
            expect(helpers_1.default.computeAgentVersionHash).toHaveBeenCalled();
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH, 'ts-test-version-hash');
        });
        it('should NOT set total_tokens or client.token.usage on the span', async () => {
            const mockArgs = [
                { messages: [{ role: 'user', content: 'Test' }], model: 'jamba-mini', stream: false },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'ai21.chat.completions',
                response: mockResponse(),
                span: mockSpan,
            });
            const attributeKeys = mockSpan.setAttribute.mock.calls.map(([key]) => key);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_USAGE_TOTAL_TOKENS);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE);
        });
        it('should never emit seed / penalty attrs and omits unset optionals', async () => {
            const mockArgs = [
                { messages: [{ role: 'user', content: 'Test' }], model: 'jamba-mini', stream: false },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'ai21.chat.completions',
                response: mockResponse(),
                span: mockSpan,
            });
            const attributeKeys = mockSpan.setAttribute.mock.calls.map(([key]) => key);
            // AI21 has no seed / frequency_penalty / presence_penalty.
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_SEED);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY);
            // Optionals not supplied in this request.
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_CHOICE_COUNT);
        });
        it('should set max_tokens, stop and choice_count only when explicitly provided', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'Test' }],
                    model: 'jamba-mini',
                    max_tokens: 200,
                    stop: ['END'],
                    n: 2,
                    stream: false,
                },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'ai21.chat.completions',
                response: mockResponse(),
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 200);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, ['END']);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_CHOICE_COUNT, 2);
        });
        it('should emit an inference event via the LoggerProvider', async () => {
            const mockArgs = [
                { messages: [{ role: 'user', content: 'Test' }], model: 'jamba-mini', stream: false },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'ai21.chat.completions',
                response: mockResponse(),
                span: mockSpan,
            });
            expect(helpers_1.default.emitInferenceEvent).toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=ai21-trace-comparison.test.js.map