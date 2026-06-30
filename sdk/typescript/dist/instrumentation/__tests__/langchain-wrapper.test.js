"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const wrapper_1 = require("../langchain/wrapper");
const helpers_1 = __importDefault(require("../../helpers"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
// `buildOutputMessages` is the observable surface for the fix — we check that
// it receives the normalised toolCalls array (not undefined).
jest.mock('../../../src/helpers', () => ({
    __esModule: true,
    default: {
        buildInputMessages: jest.fn(() => '[]'),
        buildOutputMessages: jest.fn(() => '[]'),
        updatePricingJson: jest.fn(async () => ({})),
        getChatModelCost: jest.fn(() => 0),
    },
}));
jest.mock('../../../src/config', () => ({
    __esModule: true,
    default: {
        traceContent: true,
        pricing_json: {},
        updatePricingJson: jest.fn(async () => ({})),
    },
}));
jest.mock('../../../src/instrumentation/base-wrapper', () => {
    class MockBaseWrapper {
    }
    MockBaseWrapper.setBaseSpanAttributes = jest.fn();
    MockBaseWrapper.recordMetrics = jest.fn();
    return {
        __esModule: true,
        default: MockBaseWrapper,
    };
});
const mockTracer = api_1.trace.getTracer('test-tracer');
function makeSpan() {
    const span = mockTracer.startSpan('test-span');
    span.setAttribute = jest.fn();
    return span;
}
function seedRun(handler, runId, span, modelName = 'test-model') {
    // Reach into the private `spans` map so we don't need a real LangChain
    // callback manager to set up a fake LLM run.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler.spans.set(runId, {
        span,
        startTime: Date.now() - 10,
        modelName,
        streamingContent: [],
        tokenTimestamps: [],
        promptTokens: 0,
        completionTokens: 0,
    });
}
describe('LangChain wrapper — tool_calls propagation', () => {
    let handler;
    beforeEach(() => {
        jest.clearAllMocks();
        handler = new wrapper_1.OpenLITCallbackHandler(mockTracer);
    });
    it('extracts tool_calls from AIMessage and forwards them to buildOutputMessages', async () => {
        const span = makeSpan();
        seedRun(handler, 'run-tc-1', span);
        const output = {
            generations: [
                [
                    {
                        text: '',
                        message: {
                            content: '',
                            tool_calls: [
                                { id: 'call_1', name: 'get_weather', args: { city: 'Tokyo' } },
                                { id: 'call_2', name: 'calculator', args: { expression: '2+2' } },
                            ],
                            response_metadata: { finish_reason: 'tool_calls' },
                        },
                    },
                ],
            ],
        };
        handler.handleLLMEnd(output, 'run-tc-1');
        // handleLLMEnd → _finalizeLLMSpan is async
        await new Promise((r) => setImmediate(r));
        expect(helpers_1.default.buildOutputMessages).toHaveBeenCalledTimes(1);
        const [text, finish, toolCalls] = helpers_1.default.buildOutputMessages.mock.calls[0];
        expect(text).toBe('');
        expect(finish).toBe('tool_calls');
        expect(toolCalls).toEqual([
            {
                id: 'call_1',
                type: 'function',
                name: 'get_weather',
                arguments: { city: 'Tokyo' },
            },
            {
                id: 'call_2',
                type: 'function',
                name: 'calculator',
                arguments: { expression: '2+2' },
            },
        ]);
        // Flat attributes for easy filtering
        const setAttr = span.setAttribute;
        expect(setAttr).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_NAME, 'get_weather, calculator');
        expect(setAttr).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, 'call_1, call_2');
        const toolArgsCall = setAttr.mock.calls.find((c) => c[0] === semantic_convention_1.default.GEN_AI_TOOL_CALL_ARGUMENTS);
        expect(toolArgsCall).toBeTruthy();
        expect(toolArgsCall?.[1]).toEqual(['{"city":"Tokyo"}', '{"expression":"2+2"}']);
    });
    it('passes undefined as toolCalls for text-only completions (preserves existing behaviour)', async () => {
        const span = makeSpan();
        seedRun(handler, 'run-tc-2', span);
        const output = {
            generations: [
                [
                    {
                        text: 'Hello world',
                        message: {
                            content: 'Hello world',
                            response_metadata: { finish_reason: 'stop' },
                        },
                    },
                ],
            ],
        };
        handler.handleLLMEnd(output, 'run-tc-2');
        await new Promise((r) => setImmediate(r));
        const calls = helpers_1.default.buildOutputMessages.mock.calls;
        expect(calls).toHaveLength(1);
        const [text, finish, toolCalls] = calls[0];
        expect(text).toBe('Hello world');
        expect(finish).toBe('stop');
        expect(toolCalls).toBeUndefined();
        // Flat tool attributes must NOT be set
        const setAttr = span.setAttribute;
        const toolNameCall = setAttr.mock.calls.find((c) => c[0] === semantic_convention_1.default.GEN_AI_TOOL_NAME);
        expect(toolNameCall).toBeUndefined();
    });
    it('still emits output.messages when only tool_calls are present (no assistant text)', async () => {
        const span = makeSpan();
        seedRun(handler, 'run-tc-3', span);
        const output = {
            generations: [
                [
                    {
                        text: '',
                        message: {
                            content: '',
                            tool_calls: [{ id: 'call_only', name: 'ping', args: {} }],
                            response_metadata: { finish_reason: 'tool_calls' },
                        },
                    },
                ],
            ],
        };
        handler.handleLLMEnd(output, 'run-tc-3');
        await new Promise((r) => setImmediate(r));
        const setAttr = span.setAttribute;
        const outputMsgCall = setAttr.mock.calls.find((c) => c[0] === semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES);
        expect(outputMsgCall).toBeTruthy();
        expect(helpers_1.default.buildOutputMessages).toHaveBeenCalledTimes(1);
    });
    it('reads tool_calls from additional_kwargs when not on the top-level message', async () => {
        const span = makeSpan();
        seedRun(handler, 'run-tc-4', span);
        const output = {
            generations: [
                [
                    {
                        text: '',
                        message: {
                            content: '',
                            additional_kwargs: {
                                tool_calls: [
                                    {
                                        id: 'legacy_1',
                                        type: 'function',
                                        function: { name: 'lookup', arguments: '{"k":"v"}' },
                                    },
                                ],
                            },
                            response_metadata: { finish_reason: 'tool_calls' },
                        },
                    },
                ],
            ],
        };
        handler.handleLLMEnd(output, 'run-tc-4');
        await new Promise((r) => setImmediate(r));
        const [, , toolCalls] = helpers_1.default.buildOutputMessages.mock.calls[0];
        expect(toolCalls).toEqual([
            { id: 'legacy_1', type: 'function', name: 'lookup', arguments: '{"k":"v"}' },
        ]);
    });
    it('does not merge tool_calls across multiple generations (n > 1)', async () => {
        // When the provider returns multiple choices, LangChain still collapses to
        // one assistant message and `finishReason`/`completionContent` take the
        // last writer. Tool calls must follow the same last-writer-wins rule —
        // otherwise calls from different choices get flattened into one message
        // and flat tool-name / id attributes become cross-choice joins.
        const span = makeSpan();
        seedRun(handler, 'run-tc-5', span);
        const output = {
            generations: [
                [
                    {
                        text: '',
                        message: {
                            content: '',
                            tool_calls: [{ id: 'choice_a_1', name: 'tool_a', args: {} }],
                            response_metadata: { finish_reason: 'tool_calls' },
                        },
                    },
                    {
                        text: '',
                        message: {
                            content: '',
                            tool_calls: [{ id: 'choice_b_1', name: 'tool_b', args: {} }],
                            response_metadata: { finish_reason: 'tool_calls' },
                        },
                    },
                ],
            ],
        };
        handler.handleLLMEnd(output, 'run-tc-5');
        await new Promise((r) => setImmediate(r));
        const [, , toolCalls] = helpers_1.default.buildOutputMessages.mock.calls[0];
        // Expect only the last generation's tool_calls — NOT both merged.
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0].name).toBe('tool_b');
        // Flat attributes must not be a cross-choice join like "tool_a, tool_b".
        const setAttr = span.setAttribute;
        expect(setAttr).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_NAME, 'tool_b');
        expect(setAttr).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, 'choice_b_1');
    });
    it('survives unserialisable tool arguments (circular refs / BigInt) and still ends the span', async () => {
        // If JSON.stringify throws, the outer try/catch in _finalizeLLMSpan would
        // swallow the error and leave the span un-ended + the `spans` entry
        // leaked. Guard per-argument serialisation and fall back to a sentinel.
        const span = makeSpan();
        seedRun(handler, 'run-tc-6', span);
        const circular = {};
        circular.self = circular;
        const output = {
            generations: [
                [
                    {
                        text: '',
                        message: {
                            content: '',
                            tool_calls: [
                                { id: 'call_circ', name: 'bad_args', args: circular },
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                { id: 'call_big', name: 'big_args', args: { n: 10n } },
                                { id: 'call_ok', name: 'ok_args', args: { x: 1 } },
                            ],
                            response_metadata: { finish_reason: 'tool_calls' },
                        },
                    },
                ],
            ],
        };
        expect(() => handler.handleLLMEnd(output, 'run-tc-6')).not.toThrow();
        await new Promise((r) => setImmediate(r));
        const setAttr = span.setAttribute;
        const argsCall = setAttr.mock.calls.find((c) => c[0] === semantic_convention_1.default.GEN_AI_TOOL_CALL_ARGUMENTS);
        expect(argsCall).toBeTruthy();
        const [, argsValue] = argsCall;
        expect(argsValue).toHaveLength(3);
        expect(argsValue[0]).toBe('[unserializable]'); // circular
        expect(argsValue[1]).toBe('[unserializable]'); // BigInt
        expect(argsValue[2]).toBe('{"x":1}'); // ok
        // Most important: the span was finalised, not leaked.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(handler.spans.has('run-tc-6')).toBe(false);
    });
});
//# sourceMappingURL=langchain-wrapper.test.js.map