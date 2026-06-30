"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const config_1 = __importDefault(require("../../config"));
const events_1 = __importDefault(require("../../otel/events"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const score_1 = require("../score");
function createMockSpan(isRecording = true) {
    return {
        isRecording: jest.fn().mockReturnValue(isRecording),
        addEvent: jest.fn(),
        spanContext: jest.fn().mockReturnValue({
            traceId: '0123456789abcdef0123456789abcdef',
            spanId: '0123456789abcdef',
            traceFlags: 1,
        }),
    };
}
beforeEach(() => {
    jest.restoreAllMocks();
    config_1.default.disableEvents = undefined;
    events_1.default.logger = undefined;
});
describe('logScore', () => {
    test('adds numeric score to explicit span', () => {
        const span = createMockSpan();
        const emitted = (0, score_1.logScore)({ name: 'quality', value: 0.85, span: span });
        expect(emitted).toBe(true);
        expect(span.addEvent).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_EVALUATION_RESULT, {
            [semantic_convention_1.default.GEN_AI_EVALUATION_NAME]: 'quality',
            [semantic_convention_1.default.GEN_AI_EVALUATION_SCORE_VALUE]: 0.85,
        });
    });
    test('maps true boolean score', () => {
        const span = createMockSpan();
        (0, score_1.logScore)({ name: 'user_feedback', value: true, span: span });
        expect(span.addEvent).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_EVALUATION_RESULT, {
            [semantic_convention_1.default.GEN_AI_EVALUATION_NAME]: 'user_feedback',
            [semantic_convention_1.default.GEN_AI_EVALUATION_SCORE_VALUE]: 1.0,
            [semantic_convention_1.default.GEN_AI_EVALUATION_SCORE_LABEL]: 'true',
        });
    });
    test('maps false boolean score', () => {
        const span = createMockSpan();
        (0, score_1.logScore)({ name: 'user_feedback', value: false, span: span });
        expect(span.addEvent).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_EVALUATION_RESULT, {
            [semantic_convention_1.default.GEN_AI_EVALUATION_NAME]: 'user_feedback',
            [semantic_convention_1.default.GEN_AI_EVALUATION_SCORE_VALUE]: 0.0,
            [semantic_convention_1.default.GEN_AI_EVALUATION_SCORE_LABEL]: 'false',
        });
    });
    test('maps categorical score', () => {
        const span = createMockSpan();
        (0, score_1.logScore)({ name: 'category', value: 'accurate', span: span });
        expect(span.addEvent).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_EVALUATION_RESULT, {
            [semantic_convention_1.default.GEN_AI_EVALUATION_NAME]: 'category',
            [semantic_convention_1.default.GEN_AI_EVALUATION_SCORE_LABEL]: 'accurate',
        });
    });
    test('auto-attaches to active span', () => {
        const span = createMockSpan();
        jest.spyOn(api_1.trace, 'getActiveSpan').mockReturnValue(span);
        const emitted = (0, score_1.logScore)({ name: 'quality', value: 0.5 });
        expect(emitted).toBe(true);
        expect(span.addEvent).toHaveBeenCalledTimes(1);
    });
    test('targets span from trace and span ids via log event', () => {
        config_1.default.disableEvents = false;
        events_1.default.logger = { emit: jest.fn() };
        jest.spyOn(api_1.trace, 'getActiveSpan').mockReturnValue(createMockSpan(false));
        const emitted = (0, score_1.logScore)({
            name: 'user_feedback',
            value: false,
            traceId: '0123456789abcdef0123456789abcdef',
            spanId: '0123456789abcdef',
        });
        expect(emitted).toBe(true);
        expect(events_1.default.logger.emit).toHaveBeenCalledTimes(1);
    });
    test('returns false for invalid trace and span ids', () => {
        config_1.default.disableEvents = true;
        jest.spyOn(api_1.trace, 'getActiveSpan').mockReturnValue(createMockSpan(false));
        const emitted = (0, score_1.logScore)({
            name: 'quality',
            value: 0.5,
            traceId: 'not-a-valid-trace-id',
            spanId: 'bad',
        });
        expect(emitted).toBe(false);
    });
    test('returns false without target span when events disabled', () => {
        config_1.default.disableEvents = true;
        jest.spyOn(api_1.trace, 'getActiveSpan').mockReturnValue(createMockSpan(false));
        const emitted = (0, score_1.logScore)({ name: 'quality', value: 0.5 });
        expect(emitted).toBe(false);
    });
    test('requires name', () => {
        expect(() => (0, score_1.logScore)({ name: '', value: 0.5 })).toThrow('name is required');
    });
    test('includes comment metadata and idempotency key', () => {
        const span = createMockSpan();
        (0, score_1.logScore)({
            name: 'quality',
            value: 0.9,
            span: span,
            comment: 'Looks good',
            idempotencyKey: 'score-123',
            metadata: { reviewer: 'human' },
        });
        expect(span.addEvent).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_EVALUATION_RESULT, {
            [semantic_convention_1.default.GEN_AI_EVALUATION_NAME]: 'quality',
            [semantic_convention_1.default.GEN_AI_EVALUATION_SCORE_VALUE]: 0.9,
            [semantic_convention_1.default.GEN_AI_EVALUATION_EXPLANATION]: 'Looks good',
            [semantic_convention_1.default.OPENLIT_SCORE_IDEMPOTENCY_KEY]: 'score-123',
            reviewer: 'human',
        });
    });
    test('includes array metadata values', () => {
        const span = createMockSpan();
        (0, score_1.logScore)({
            name: 'quality',
            value: 0.9,
            span: span,
            metadata: { tags: ['human', 'reviewed'] },
        });
        expect(span.addEvent).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_EVALUATION_RESULT, expect.objectContaining({
            tags: ['human', 'reviewed'],
        }));
    });
    test('includes custom span attributes', () => {
        const span = createMockSpan();
        const helpers = require('../../helpers');
        jest.spyOn(helpers, 'getMergedCustomAttributes').mockReturnValue({ 'session.id': 'sess-1' });
        (0, score_1.logScore)({ name: 'quality', value: 0.5, span: span });
        expect(span.addEvent).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_EVALUATION_RESULT, expect.objectContaining({
            'session.id': 'sess-1',
        }));
    });
});
//# sourceMappingURL=score.test.js.map