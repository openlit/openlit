import { trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import Events from '../../otel/events';
import SemanticConvention from '../../semantic-convention';
import { logScore } from '../score';

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
  OpenlitConfig.disableEvents = undefined;
  (Events as any).logger = undefined;
});

describe('logScore', () => {
  test('adds numeric score to explicit span', () => {
    const span = createMockSpan();

    const emitted = logScore({ name: 'quality', value: 0.85, span: span as any });

    expect(emitted).toBe(true);
    expect(span.addEvent).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_EVALUATION_RESULT,
      {
        [SemanticConvention.GEN_AI_EVALUATION_NAME]: 'quality',
        [SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE]: 0.85,
      }
    );
  });

  test('maps true boolean score', () => {
    const span = createMockSpan();

    logScore({ name: 'user_feedback', value: true, span: span as any });

    expect(span.addEvent).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_EVALUATION_RESULT,
      {
        [SemanticConvention.GEN_AI_EVALUATION_NAME]: 'user_feedback',
        [SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE]: 1.0,
        [SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL]: 'true',
      }
    );
  });

  test('maps false boolean score', () => {
    const span = createMockSpan();

    logScore({ name: 'user_feedback', value: false, span: span as any });

    expect(span.addEvent).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_EVALUATION_RESULT,
      {
        [SemanticConvention.GEN_AI_EVALUATION_NAME]: 'user_feedback',
        [SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE]: 0.0,
        [SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL]: 'false',
      }
    );
  });

  test('maps categorical score', () => {
    const span = createMockSpan();

    logScore({ name: 'category', value: 'accurate', span: span as any });

    expect(span.addEvent).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_EVALUATION_RESULT,
      {
        [SemanticConvention.GEN_AI_EVALUATION_NAME]: 'category',
        [SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL]: 'accurate',
      }
    );
  });

  test('auto-attaches to active span', () => {
    const span = createMockSpan();
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue(span as any);

    const emitted = logScore({ name: 'quality', value: 0.5 });

    expect(emitted).toBe(true);
    expect(span.addEvent).toHaveBeenCalledTimes(1);
  });

  test('targets span from trace and span ids via log event', () => {
    OpenlitConfig.disableEvents = false;
    (Events as any).logger = { emit: jest.fn() };
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue(createMockSpan(false) as any);

    const emitted = logScore({
      name: 'user_feedback',
      value: false,
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
    });

    expect(emitted).toBe(true);
    expect((Events as any).logger.emit).toHaveBeenCalledTimes(1);
  });

  test('returns false for invalid trace and span ids', () => {
    OpenlitConfig.disableEvents = true;
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue(createMockSpan(false) as any);

    const emitted = logScore({
      name: 'quality',
      value: 0.5,
      traceId: 'not-a-valid-trace-id',
      spanId: 'bad',
    });

    expect(emitted).toBe(false);
  });

  test('returns false without target span when events disabled', () => {
    OpenlitConfig.disableEvents = true;
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue(createMockSpan(false) as any);

    const emitted = logScore({ name: 'quality', value: 0.5 });

    expect(emitted).toBe(false);
  });

  test('requires name', () => {
    expect(() => logScore({ name: '', value: 0.5 })).toThrow('name is required');
  });

  test('includes comment metadata and idempotency key', () => {
    const span = createMockSpan();

    logScore({
      name: 'quality',
      value: 0.9,
      span: span as any,
      comment: 'Looks good',
      idempotencyKey: 'score-123',
      metadata: { reviewer: 'human' },
    });

    expect(span.addEvent).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_EVALUATION_RESULT,
      {
        [SemanticConvention.GEN_AI_EVALUATION_NAME]: 'quality',
        [SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE]: 0.9,
        [SemanticConvention.GEN_AI_EVALUATION_EXPLANATION]: 'Looks good',
        [SemanticConvention.OPENLIT_SCORE_IDEMPOTENCY_KEY]: 'score-123',
        reviewer: 'human',
      }
    );
  });

  test('includes array metadata values', () => {
    const span = createMockSpan();

    logScore({
      name: 'quality',
      value: 0.9,
      span: span as any,
      metadata: { tags: ['human', 'reviewed'] },
    });

    expect(span.addEvent).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_EVALUATION_RESULT,
      expect.objectContaining({
        tags: ['human', 'reviewed'],
      })
    );
  });

  test('includes custom span attributes', () => {
    const span = createMockSpan();
    const helpers = require('../../helpers');
    jest.spyOn(helpers, 'getMergedCustomAttributes').mockReturnValue({ 'session.id': 'sess-1' });

    logScore({ name: 'quality', value: 0.5, span: span as any });

    expect(span.addEvent).toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_EVALUATION_RESULT,
      expect.objectContaining({
        'session.id': 'sess-1',
      })
    );
  });
});
