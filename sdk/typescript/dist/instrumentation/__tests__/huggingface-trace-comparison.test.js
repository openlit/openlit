"use strict";
/**
 * Cross-Language Trace Comparison Tests for HuggingFace Inference Integration
 *
 * Verifies that the TypeScript SDK generates traces consistent with
 * OTel GenAI semantic conventions and the OpenAI reference wrapper pattern.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const wrapper_1 = __importDefault(require("../huggingface/wrapper"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');
describe('HuggingFace Cross-Language Trace Comparison', () => {
    let mockSpan;
    let mockTracer;
    beforeEach(() => {
        mockSpan = {
            setAttribute: jest.fn(),
            addEvent: jest.fn(),
            end: jest.fn(),
            setStatus: jest.fn(),
        };
        mockTracer = {
            startSpan: jest.fn().mockReturnValue(mockSpan),
        };
        config_1.default.environment = 'openlit-testing';
        config_1.default.applicationName = 'openlit-test';
        config_1.default.captureMessageContent = true;
        config_1.default.pricingInfo = {};
        config_1.default.disableEvents = false;
        helpers_1.default.getChatModelCost = jest.fn().mockReturnValue(0.0005);
        helpers_1.default.generalTokens = jest.fn().mockReturnValue(8);
        helpers_1.default.buildInputMessages = jest.fn().mockReturnValue('[]');
        helpers_1.default.buildOutputMessages = jest.fn().mockReturnValue('[]');
        helpers_1.default.handleException = jest.fn();
        helpers_1.default.emitInferenceEvent = jest.fn();
        helpers_1.default.createStreamProxy = jest.fn().mockImplementation((stream, _gen) => stream);
        base_wrapper_1.default.recordMetrics = jest.fn();
        base_wrapper_1.default.setBaseSpanAttributes = jest.fn().mockImplementation((span, attrs) => {
            span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, attrs.aiSystem);
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, attrs.model);
            if (attrs.cost !== undefined)
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_COST, attrs.cost);
            if (attrs.serverAddress)
                span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, attrs.serverAddress);
            if (attrs.serverPort !== undefined)
                span.setAttribute(semantic_convention_1.default.SERVER_PORT, attrs.serverPort);
        });
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    // ── Span Creation ──────────────────────────────────────────────────────────
    describe('Span Creation', () => {
        it('should create span with name "{operation} {model}"', () => {
            const patchedFn = wrapper_1.default._patchChatCompletion(mockTracer);
            const originalMethod = jest.fn().mockResolvedValue({
                id: 'test', model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            });
            const wrapped = patchedFn(originalMethod);
            wrapped.call({}, { model: 'meta-llama/Meta-Llama-3-8B-Instruct', messages: [] });
            expect(mockTracer.startSpan).toHaveBeenCalledWith('chat meta-llama/Meta-Llama-3-8B-Instruct', expect.objectContaining({
                kind: expect.any(Number),
                attributes: expect.objectContaining({
                    [semantic_convention_1.default.GEN_AI_OPERATION]: 'chat',
                    [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: 'huggingface',
                    [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: 'meta-llama/Meta-Llama-3-8B-Instruct',
                    [semantic_convention_1.default.SERVER_ADDRESS]: 'api-inference.huggingface.co',
                    [semantic_convention_1.default.SERVER_PORT]: 443,
                }),
            }), expect.anything());
        });
        it('should create text generation span with name "text_completion {model}"', () => {
            const patchedFn = wrapper_1.default._patchTextGeneration(mockTracer);
            const originalMethod = jest.fn().mockResolvedValue({ generated_text: 'result' });
            const wrapped = patchedFn(originalMethod);
            wrapped.call({}, { model: 'gpt2', inputs: 'test' });
            expect(mockTracer.startSpan).toHaveBeenCalledWith('text_completion gpt2', expect.objectContaining({
                attributes: expect.objectContaining({
                    [semantic_convention_1.default.GEN_AI_OPERATION]: 'text_completion',
                    [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: 'huggingface',
                    [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: 'gpt2',
                }),
            }), expect.anything());
        });
    });
    // ── Chat Completion ───────────────────────────────────────────────────────
    describe('Chat Completion', () => {
        const mockArgs = [
            {
                model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                messages: [{ role: 'user', content: 'What is LLM Observability?' }],
                max_tokens: 100,
                temperature: 0.7,
                stream: false,
            },
        ];
        const mockResponse = {
            id: 'hf-chat-123',
            created: Date.now(),
            model: 'meta-llama/Meta-Llama-3-8B-Instruct',
            choices: [
                {
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: 'LLM Observability is...' },
                },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 25, total_tokens: 37 },
        };
        it('should set gen_ai.provider.name = "huggingface" via setBaseSpanAttributes', async () => {
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(base_wrapper_1.default.setBaseSpanAttributes).toHaveBeenCalledWith(mockSpan, expect.objectContaining({ aiSystem: 'huggingface' }));
        });
        it('should set token usage attributes without sentinel total_tokens', async () => {
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 12);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 25);
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_TOTAL_TOKENS, expect.anything());
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE, expect.anything());
        });
        it('should set server.address and server.port via setBaseSpanAttributes', async () => {
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(base_wrapper_1.default.setBaseSpanAttributes).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
                serverAddress: 'api-inference.huggingface.co',
                serverPort: 443,
            }));
        });
        it('should set request params: temperature, max_tokens, top_p, is_stream', async () => {
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.7);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 100);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, 1);
        });
        it('should conditionally set frequency_penalty, presence_penalty, seed, stop', async () => {
            const argsWithExtras = [
                {
                    ...mockArgs[0],
                    frequency_penalty: 0.5,
                    presence_penalty: 0.3,
                    seed: 42,
                    stop: ['\n'],
                    n: 2,
                },
            ];
            await wrapper_1.default._chatCompletion({
                args: argsWithExtras,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, 0.5);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, 0.3);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_SEED, 42);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, ['\n']);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_CHOICE_COUNT, 2);
        });
        it('should NOT set frequency_penalty or presence_penalty when 0', async () => {
            await wrapper_1.default._chatCompletion({
                args: [{ ...mockArgs[0], frequency_penalty: 0, presence_penalty: 0 }],
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, expect.anything());
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, expect.anything());
        });
        it('should set finish_reason and output_type', async () => {
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
        });
        it('should emit inference event via emitInferenceEvent', async () => {
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(helpers_1.default.emitInferenceEvent).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
                [semantic_convention_1.default.GEN_AI_OPERATION]: 'chat',
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: 'meta-llama/Meta-Llama-3-8B-Instruct',
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: 'meta-llama/Meta-Llama-3-8B-Instruct',
                [semantic_convention_1.default.SERVER_ADDRESS]: 'api-inference.huggingface.co',
                [semantic_convention_1.default.SERVER_PORT]: 443,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: 12,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: 25,
            }));
        });
        it('should not emit event when disableEvents=true', async () => {
            config_1.default.disableEvents = true;
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(helpers_1.default.emitInferenceEvent).not.toHaveBeenCalled();
        });
        it('should call recordMetrics after span ends', async () => {
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(mockSpan.end).toHaveBeenCalled();
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
                genAIEndpoint: 'huggingface.chat.completions',
                model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                aiSystem: 'huggingface',
            }));
        });
        it('should use OpenlitConfig.pricingInfo for cost calculation', async () => {
            config_1.default.pricingInfo = { chat: {} };
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(helpers_1.default.getChatModelCost).toHaveBeenCalledWith('meta-llama/Meta-Llama-3-8B-Instruct', { chat: {} }, 12, 25);
        });
    });
    // ── Error Handling ─────────────────────────────────────────────────────────
    describe('Error Handling', () => {
        it('should record metrics with errorType on catch path', async () => {
            const patchedFn = wrapper_1.default._patchChatCompletion(mockTracer);
            const error = new TypeError('network failure');
            const originalMethod = jest.fn().mockRejectedValue(error);
            const wrapped = patchedFn(originalMethod);
            await expect(wrapped.call({}, { model: 'test-model', messages: [] })).rejects.toThrow('network failure');
            expect(helpers_1.default.handleException).toHaveBeenCalledWith(mockSpan, error);
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
                errorType: 'TypeError',
                model: 'test-model',
                aiSystem: 'huggingface',
                serverAddress: 'api-inference.huggingface.co',
                serverPort: 443,
            }));
            expect(mockSpan.end).toHaveBeenCalled();
        });
        it('should record metrics with errorType on text generation error', async () => {
            const patchedFn = wrapper_1.default._patchTextGeneration(mockTracer);
            const error = new RangeError('out of bounds');
            const originalMethod = jest.fn().mockRejectedValue(error);
            const wrapped = patchedFn(originalMethod);
            await expect(wrapped.call({}, { model: 'gpt2', inputs: 'test' })).rejects.toThrow('out of bounds');
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
                errorType: 'RangeError',
                model: 'gpt2',
                aiSystem: 'huggingface',
            }));
        });
    });
    // ── Streaming ─────────────────────────────────────────────────────────────
    describe('Streaming Chat Completion', () => {
        it('should set is_stream=true and accumulate content across chunks', async () => {
            const mockArgs = [
                {
                    model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                    messages: [{ role: 'user', content: 'Hello' }],
                    stream: true,
                },
            ];
            async function* mockStream() {
                yield {
                    id: 'hf-stream-1',
                    created: Date.now(),
                    model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                    choices: [{ delta: { content: 'Hello' } }],
                };
                yield {
                    id: 'hf-stream-1',
                    created: Date.now(),
                    model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                    choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }],
                };
            }
            const generator = wrapper_1.default._chatCompletionGenerator({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockStream(),
                span: mockSpan,
            });
            for await (const _ of generator) { /* consume */ }
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, true);
            expect(mockSpan.end).toHaveBeenCalled();
            expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalled();
            expect(helpers_1.default.emitInferenceEvent).toHaveBeenCalled();
        });
        it('should handle tool call deltas across streaming chunks', async () => {
            const mockArgs = [
                {
                    model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                    messages: [{ role: 'user', content: 'Weather?' }],
                    stream: true,
                },
            ];
            async function* mockStream() {
                yield {
                    id: 'hf-stream-tc',
                    model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                    choices: [{
                            delta: {
                                tool_calls: [{
                                        index: 0,
                                        id: 'call_1',
                                        type: 'function',
                                        function: { name: 'get_weather', arguments: '{"loc' },
                                    }],
                            },
                        }],
                };
                yield {
                    id: 'hf-stream-tc',
                    model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                    choices: [{
                            delta: {
                                tool_calls: [{
                                        index: 0,
                                        function: { arguments: '":"SF"}' },
                                    }],
                            },
                            finish_reason: 'tool_calls',
                        }],
                };
            }
            const generator = wrapper_1.default._chatCompletionGenerator({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockStream(),
                span: mockSpan,
            });
            for await (const _ of generator) { /* consume */ }
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_NAME, 'get_weather');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, 'call_1');
        });
    });
    // ── Text Generation ───────────────────────────────────────────────────────
    describe('Text Generation', () => {
        it('should set text_completion operation and correct attributes', async () => {
            const mockArgs = [
                {
                    model: 'gpt2',
                    inputs: 'The meaning of life is',
                    parameters: { max_new_tokens: 50, temperature: 0.9 },
                },
            ];
            const mockResponse = { generated_text: 'The meaning of life is 42.' };
            await wrapper_1.default._textGeneration({
                args: mockArgs,
                genAIEndpoint: 'huggingface.text.generation',
                response: mockResponse,
                span: mockSpan,
            });
            expect(base_wrapper_1.default.setBaseSpanAttributes).toHaveBeenCalledWith(mockSpan, expect.objectContaining({ aiSystem: 'huggingface' }));
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, 50);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, 0.9);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
            expect(mockSpan.end).toHaveBeenCalled();
        });
        it('should use OTel message format for input/output content', async () => {
            const mockArgs = [
                {
                    model: 'gpt2',
                    inputs: 'The meaning of life is',
                    parameters: {},
                },
            ];
            const mockResponse = { generated_text: '42.' };
            await wrapper_1.default._textGeneration({
                args: mockArgs,
                genAIEndpoint: 'huggingface.text.generation',
                response: mockResponse,
                span: mockSpan,
            });
            expect(helpers_1.default.buildInputMessages).toHaveBeenCalledWith([{ role: 'user', content: 'The meaning of life is' }]);
            expect(helpers_1.default.buildOutputMessages).toHaveBeenCalledWith('42.', 'stop');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, expect.any(String));
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, expect.any(String));
        });
        it('should emit inference event for text generation', async () => {
            const mockArgs = [
                {
                    model: 'gpt2',
                    inputs: 'test',
                    parameters: {},
                },
            ];
            const mockResponse = { generated_text: 'result' };
            await wrapper_1.default._textGeneration({
                args: mockArgs,
                genAIEndpoint: 'huggingface.text.generation',
                response: mockResponse,
                span: mockSpan,
            });
            expect(helpers_1.default.emitInferenceEvent).toHaveBeenCalledWith(mockSpan, expect.objectContaining({
                [semantic_convention_1.default.GEN_AI_OPERATION]: 'text_completion',
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: 'gpt2',
                [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT,
            }));
        });
        it('should not set legacy content attributes', async () => {
            const mockArgs = [
                {
                    model: 'gpt2',
                    inputs: 'The meaning of life is',
                    parameters: {},
                },
            ];
            const mockResponse = { generated_text: '42.' };
            await wrapper_1.default._textGeneration({
                args: mockArgs,
                genAIEndpoint: 'huggingface.text.generation',
                response: mockResponse,
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_CONTENT_PROMPT_EVENT, expect.anything());
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_CONTENT_COMPLETION_EVENT, expect.anything());
        });
        it('should not set total_tokens or client.token.usage (legacy)', async () => {
            const mockArgs = [
                {
                    model: 'gpt2',
                    inputs: 'test',
                    parameters: {},
                },
            ];
            const mockResponse = { generated_text: 'result' };
            await wrapper_1.default._textGeneration({
                args: mockArgs,
                genAIEndpoint: 'huggingface.text.generation',
                response: mockResponse,
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_TOTAL_TOKENS, expect.anything());
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE, expect.anything());
        });
    });
    // ── Content Gating ─────────────────────────────────────────────────────────
    describe('Content capture gating', () => {
        it('should not set input/output messages when captureMessageContent=false', async () => {
            config_1.default.captureMessageContent = false;
            const mockArgs = [
                {
                    model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                    messages: [{ role: 'user', content: 'Secret' }],
                    stream: false,
                },
            ];
            const mockResponse = {
                id: 'hf-123',
                model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                choices: [{ message: { content: 'Reply' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            };
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, expect.anything());
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, expect.anything());
        });
        it('should still emit event even when captureMessageContent=false', async () => {
            config_1.default.captureMessageContent = false;
            const mockArgs = [
                {
                    model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                    messages: [{ role: 'user', content: 'Secret' }],
                    stream: false,
                },
            ];
            const mockResponse = {
                id: 'hf-123',
                model: 'meta-llama/Meta-Llama-3-8B-Instruct',
                choices: [{ message: { content: 'Reply' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            };
            await wrapper_1.default._chatCompletion({
                args: mockArgs,
                genAIEndpoint: 'huggingface.chat.completions',
                response: mockResponse,
                span: mockSpan,
            });
            expect(helpers_1.default.emitInferenceEvent).toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=huggingface-trace-comparison.test.js.map