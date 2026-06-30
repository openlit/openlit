"use strict";
/**
 * Cross-Language Trace Comparison Tests for the DigitalOcean Gradient Integration
 *
 * These verify that the TypeScript Gradient instrumentation emits the same span
 * attributes / events as the Python SDK reference
 * (sdk/python/src/openlit/instrumentation/gradient). Gradient is OpenAI-shaped:
 * responses carry a `model` field, requests support seed / frequency_penalty /
 * presence_penalty, and streaming usage arrives on the final chunk as `usage`.
 * The provider name is `digitalocean` and chat is served from inference.do-ai.run.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const wrapper_1 = __importDefault(require("../gradient/wrapper"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
jest.mock('../../config');
jest.mock('../../helpers', () => ({
    __esModule: true,
    default: {},
    isFrameworkLlmActive: jest.fn(() => false),
    getFrameworkParentContext: jest.fn(() => undefined),
    getCurrentAgentVersion: jest.fn(() => undefined),
}));
jest.mock('../base-wrapper');
const SERVER = { serverAddress: 'inference.do-ai.run', serverPort: 443 };
const AGENT_SERVER = { serverAddress: 'abc123.agents.do-ai.run', serverPort: 443 };
describe('Gradient Cross-Language Trace Comparison', () => {
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
        helpers_1.default.getImageModelCost = jest.fn().mockReturnValue(0.05);
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
    const mockResponse = () => ({
        id: 'gradient-test-id',
        model: 'llama3.3-70b-instruct',
        choices: [
            {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: 'DO says hi', reasoning_content: 'thinking...' },
            },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    describe('Chat Completion Trace Consistency', () => {
        it('should set the same core attributes as the Python SDK', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'What is LLM Observability?' }],
                    model: 'llama3.3-70b-instruct',
                    max_tokens: 100,
                    temperature: 0.7,
                    stream: false,
                },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.chat.completions',
                response: mockResponse(),
                span: mockSpan,
                ...SERVER,
                operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                apiType: 'chat',
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, 'digitalocean');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, 'llama3.3-70b-instruct');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'llama3.3-70b-instruct');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_ID, 'gradient-test-id');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 10);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE, 30);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.7);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 100);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, 'text');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.OPENAI_API_TYPE, 'chat');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_ADDRESS, 'inference.do-ai.run');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_PORT, 443);
        });
        it('prefers max_completion_tokens over max_tokens (Python parity)', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'Test' }],
                    model: 'llama3.3-70b-instruct',
                    max_tokens: 50,
                    max_completion_tokens: 128,
                    stream: false,
                },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.chat.completions',
                response: mockResponse(),
                span: mockSpan,
                ...SERVER,
                operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                apiType: 'chat',
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 128);
        });
        it('falls back to the "unknown" request model when none is supplied (matches Python)', async () => {
            const mockArgs = [{ messages: [{ role: 'user', content: 'Test' }], stream: false }];
            const responseNoModel = { ...mockResponse(), model: '' };
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.chat.completions',
                response: responseNoModel,
                span: mockSpan,
                ...SERVER,
                operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                apiType: 'chat',
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, 'unknown');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'unknown');
        });
        it('stamps openlit.agent.version_hash on the chat span', async () => {
            const mockArgs = [
                { messages: [{ role: 'user', content: 'Hash me' }], model: 'llama3.3-70b-instruct', stream: false },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.chat.completions',
                response: mockResponse(),
                span: mockSpan,
                ...SERVER,
                operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                apiType: 'chat',
            });
            expect(helpers_1.default.computeAgentVersionHash).toHaveBeenCalled();
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH, 'ts-test-version-hash');
        });
        it('should NOT set total_tokens on the span', async () => {
            const mockArgs = [
                { messages: [{ role: 'user', content: 'Test' }], model: 'llama3.3-70b-instruct', stream: false },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.chat.completions',
                response: mockResponse(),
                span: mockSpan,
                ...SERVER,
                operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                apiType: 'chat',
            });
            const attributeKeys = mockSpan.setAttribute.mock.calls.map(([key]) => key);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_USAGE_TOTAL_TOKENS);
        });
        it('omits seed / penalties / optionals when not provided (no sentinel values)', async () => {
            const mockArgs = [
                { messages: [{ role: 'user', content: 'Test' }], model: 'llama3.3-70b-instruct', stream: false },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.chat.completions',
                response: mockResponse(),
                span: mockSpan,
                ...SERVER,
                operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                apiType: 'chat',
            });
            const attributeKeys = mockSpan.setAttribute.mock.calls.map(([key]) => key);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_SEED);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES);
            expect(attributeKeys).not.toContain(semantic_convention_1.default.GEN_AI_REQUEST_CHOICE_COUNT);
        });
        it('sets seed / penalties when explicitly provided (Gradient is OpenAI-compatible)', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'Test' }],
                    model: 'llama3.3-70b-instruct',
                    seed: 42,
                    frequency_penalty: 0.5,
                    presence_penalty: 0.3,
                    stop: ['END'],
                    n: 2,
                    reasoning_effort: 'high',
                    stream: false,
                },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.chat.completions',
                response: mockResponse(),
                span: mockSpan,
                ...SERVER,
                operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                apiType: 'chat',
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_SEED, 42);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, 0.5);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, 0.3);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, ['END']);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_CHOICE_COUNT, 2);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_REASONING_EFFORT, 'high');
        });
        it('does not throw and still records tokens when the response omits usage', async () => {
            const mockArgs = [
                { messages: [{ role: 'user', content: 'Test' }], model: 'llama3.3-70b-instruct', stream: false },
            ];
            const responseNoUsage = mockResponse();
            delete responseNoUsage.usage;
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.chat.completions',
                response: responseNoUsage,
                span: mockSpan,
                ...SERVER,
                operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                apiType: 'chat',
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 0);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 0);
        });
        it('should emit an inference event via the LoggerProvider', async () => {
            const mockArgs = [
                { messages: [{ role: 'user', content: 'Test' }], model: 'llama3.3-70b-instruct', stream: false },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.chat.completions',
                response: mockResponse(),
                span: mockSpan,
                ...SERVER,
                operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                apiType: 'chat',
            });
            expect(helpers_1.default.emitInferenceEvent).toHaveBeenCalled();
        });
    });
    describe('Agent Chat Completion Trace Consistency', () => {
        it('emits invoke_agent operation in inference events (Python parity)', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'Run agent' }],
                    model: 'agent-model',
                    stream: false,
                },
            ];
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.agents.chat.completions',
                response: mockResponse(),
                span: mockSpan,
                ...AGENT_SERVER,
                operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
                apiType: 'chat',
            });
            expect(helpers_1.default.emitInferenceEvent).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
            }));
        });
    });
    describe('Image Generation Trace Consistency', () => {
        it('sets image output type and cost like Python process_image_response', async () => {
            const mockArgs = [
                {
                    prompt: 'A cute otter',
                    model: 'gpt-image-1',
                    size: '1024x1024',
                    quality: 'high',
                },
            ];
            const response = {
                created: 1710000000,
                model: 'gpt-image-1',
                data: [{ b64_json: 'abc', revised_prompt: 'A very cute otter' }],
            };
            wrapper_1.default._imageGenerateCommonSetter({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.images.generate',
                response,
                span: mockSpan,
                ...SERVER,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, 'image');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_ID, String(1710000000));
            expect(helpers_1.default.getImageModelCost).toHaveBeenCalledWith('gpt-image-1', {}, '1024x1024', 'high');
        });
    });
    describe('Streaming Trace Consistency', () => {
        async function* mockStream() {
            yield {
                id: 'gradient-stream-id',
                model: 'llama3.3-70b-instruct',
                choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }],
            };
            yield {
                id: 'gradient-stream-id',
                model: 'llama3.3-70b-instruct',
                choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }],
            };
            yield {
                id: 'gradient-stream-id',
                model: 'llama3.3-70b-instruct',
                choices: [],
                usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18 },
            };
        }
        it('aggregates streamed content and reads usage from the final chunk', async () => {
            const mockArgs = [
                {
                    messages: [{ role: 'user', content: 'Hi' }],
                    model: 'llama3.3-70b-instruct',
                    stream: true,
                },
            ];
            const generator = wrapper_1.default._chatCompletionGenerator({
                args: mockArgs,
                genAIEndpoint: 'digitalocean.chat.completions',
                response: mockStream(),
                span: mockSpan,
                ...SERVER,
                operationName: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT,
                apiType: 'chat',
            });
            let step = await generator.next();
            while (!step.done) {
                step = await generator.next();
            }
            const final = step.value;
            expect(final.choices[0].message.content).toBe('Hello world');
            expect(final.choices[0].finish_reason).toBe('stop');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 7);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 11);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, true);
        });
    });
});
//# sourceMappingURL=gradient-trace-comparison.test.js.map