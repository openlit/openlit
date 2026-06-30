"use strict";
/**
 * Cross-Language Trace Comparison Tests for the AI21 Conversational RAG path.
 *
 * Verifies that the TypeScript AI21 RAG instrumentation emits the same span
 * attributes as the Python SDK reference
 * (sdk/python/src/openlit/instrumentation/ai21: chat_rag / common_chat_rag_logic).
 * The RAG response shape differs from chat: the answer lives at
 * `choices[i].content` (not `choices[i].message.content`), there is no `model`
 * field (falls back to the request model), no usage token counts (counted
 * locally), and the path is never streamed. It additionally emits six
 * `gen_ai.rag.*` attributes mirrored from the Python implementation.
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
describe('AI21 Conversational RAG Trace Comparison', () => {
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
        helpers_1.default.getChatModelCost = jest.fn().mockReturnValue(0.002);
        helpers_1.default.openaiTokens = jest.fn().mockReturnValue(5);
        helpers_1.default.handleException = jest.fn();
        helpers_1.default.buildInputMessages = jest.fn().mockReturnValue('[input]');
        helpers_1.default.buildOutputMessages = jest.fn().mockReturnValue('[output]');
        helpers_1.default.buildSystemInstructionsFromMessages = jest.fn().mockReturnValue(undefined);
        helpers_1.default.buildToolDefinitions = jest.fn().mockReturnValue(undefined);
        helpers_1.default.emitInferenceEvent = jest.fn();
        helpers_1.default.computeAgentVersionHash = jest.fn().mockReturnValue('rag-test-hash');
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
        });
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    // AI21 ConversationalRagResponse shape: choices are ChatMessage[] with a flat
    // `content` field, no `model`, no `usage` token counts.
    const mockRagResponse = () => ({
        id: 'ai21-rag-id',
        choices: [{ role: 'assistant', content: 'Jamba RAG answer' }],
        context_retrieved: true,
        answer_in_context: true,
        sources: [],
    });
    it('sets the same core chat attributes as the Python RAG path', async () => {
        const args = [
            {
                messages: [{ role: 'user', content: 'What does the doc say?' }],
                model: 'jamba-large',
                file_ids: ['f1'],
            },
        ];
        await wrapper_1.default._chatRag({
            args,
            genAIEndpoint: 'ai21.conversational_rag',
            response: mockRagResponse(),
            span: mockSpan,
        });
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, 'ai21');
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, 'jamba-large');
        // RAG responses carry no `model`, so it falls back to the request model.
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, 'jamba-large');
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RESPONSE_ID, 'ai21-rag-id');
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_ADDRESS, 'api.ai21.com');
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_PORT, 443);
    });
    it('sets the six RAG-specific attributes from request kwargs', async () => {
        const args = [
            {
                messages: [{ role: 'user', content: 'q' }],
                model: 'jamba-mini',
                max_segments: 10,
                retrieval_strategy: 'semantic',
                max_neighbors: 3,
                file_ids: ['fileA', 'fileB'],
                path: '/docs',
                retrieval_similarity_threshold: 0.5,
            },
        ];
        await wrapper_1.default._chatRag({
            args,
            genAIEndpoint: 'ai21.conversational_rag',
            response: mockRagResponse(),
            span: mockSpan,
        });
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_MAX_SEGMENTS, 10);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_STRATEGY, 'semantic');
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_MAX_NEIGHBORS, 3);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_FILE_IDS, String(['fileA', 'fileB']));
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_DOCUMENTS_PATH, '/docs');
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_SIMILARITY_THRESHOLD, 0.5);
    });
    it('applies Python-parity defaults for omitted RAG kwargs', async () => {
        const args = [{ messages: [{ role: 'user', content: 'q' }], model: 'jamba-mini' }];
        await wrapper_1.default._chatRag({
            args,
            genAIEndpoint: 'ai21.conversational_rag',
            response: mockRagResponse(),
            span: mockSpan,
        });
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_MAX_SEGMENTS, -1);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_STRATEGY, 'segments');
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_MAX_NEIGHBORS, -1);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_FILE_IDS, '');
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_DOCUMENTS_PATH, '');
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_RAG_SIMILARITY_THRESHOLD, -1);
    });
    it('reads the answer from choices[].content and records token usage', async () => {
        const args = [{ messages: [{ role: 'user', content: 'q' }], model: 'jamba-mini' }];
        await wrapper_1.default._chatRag({
            args,
            genAIEndpoint: 'ai21.conversational_rag',
            response: mockRagResponse(),
            span: mockSpan,
        });
        // openaiTokens mocked to 5: 1 input message => 5, output answer => 5.
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, 5);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, 5);
        // RAG choices have no tool_calls, so the third arg is undefined.
        expect(helpers_1.default.buildOutputMessages).toHaveBeenCalledWith('Jamba RAG answer', 'stop', undefined);
    });
    it('marks the RAG span as non-streaming with text output', async () => {
        const args = [{ messages: [{ role: 'user', content: 'q' }], model: 'jamba-mini' }];
        await wrapper_1.default._chatRag({
            args,
            genAIEndpoint: 'ai21.conversational_rag',
            response: mockRagResponse(),
            span: mockSpan,
        });
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
    });
    it('ends the span and records metrics', async () => {
        const args = [{ messages: [{ role: 'user', content: 'q' }], model: 'jamba-mini' }];
        await wrapper_1.default._chatRag({
            args,
            genAIEndpoint: 'ai21.conversational_rag',
            response: mockRagResponse(),
            span: mockSpan,
        });
        expect(mockSpan.end).toHaveBeenCalled();
        expect(base_wrapper_1.default.recordMetrics).toHaveBeenCalled();
    });
});
//# sourceMappingURL=ai21-rag-trace-comparison.test.js.map