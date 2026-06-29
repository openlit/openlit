import { Attributes, AttributeValue, Span, SpanContext, TraceFlags, trace, context as otelContext } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import OpenlitConfig from '../config';
import { getMergedCustomAttributes } from '../helpers';
import Events from '../otel/events';
import SemanticConvention from '../semantic-convention';

type OtelSafeMetadataValue = string | number | boolean;
type OtelSafeMetadataArray = OtelSafeMetadataValue[];

export interface LogScoreOptions {
  name: string;
  value: number | boolean | string;
  span?: Span;
  traceId?: string;
  spanId?: string;
  comment?: string;
  idempotencyKey?: string;
  metadata?: Record<string, OtelSafeMetadataValue | OtelSafeMetadataArray>;
}

type ScoreValue = number | boolean | string;

function normalizeScoreValue(value: ScoreValue): Attributes {
  if (typeof value === 'boolean') {
    return {
      [SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE]: value ? 1.0 : 0.0,
      [SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL]: value ? 'true' : 'false',
    };
  }
  if (typeof value === 'number') {
    return { [SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE]: value };
  }
  return { [SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL]: value };
}

function eventsDisabled(): boolean {
  return Boolean(OpenlitConfig.disableEvents);
}

function isOtelSafeMetadataValue(value: unknown): value is OtelSafeMetadataValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function mergeMetadata(
  eventAttributes: Attributes,
  metadata?: Record<string, OtelSafeMetadataValue | OtelSafeMetadataArray>
): void {
  if (!metadata) {
    return;
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (isOtelSafeMetadataValue(value)) {
      eventAttributes[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.every(isOtelSafeMetadataValue)) {
      eventAttributes[key] = value as AttributeValue;
    }
  }
}

function mergeCustomEventAttributes(eventAttributes: Attributes): void {
  const customAttrs = getMergedCustomAttributes();
  for (const [key, value] of Object.entries(customAttrs)) {
    if (value !== undefined && value !== null) {
      if (!(key in eventAttributes)) {
        eventAttributes[key] = value;
      }
    }
  }
}

const HEX_RE = /^[0-9a-fA-F]+$/;

function validHexId(value: string, expectedLen: number): boolean {
  return value.length === expectedLen && HEX_RE.test(value);
}

function spanFromIds(traceId: string, spanId: string): Span | undefined {
  if (!validHexId(traceId, 32) || !validHexId(spanId, 16)) {
    return undefined;
  }
  const spanContext: SpanContext = {
    traceId,
    spanId,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  };
  return trace.wrapSpanContext(spanContext);
}

function resolveTargetSpan(options: LogScoreOptions): Span | undefined {
  if (options.span) {
    return options.span;
  }
  const activeSpan = trace.getActiveSpan();
  if (activeSpan?.isRecording()) {
    return activeSpan;
  }
  if (options.traceId && options.spanId) {
    return spanFromIds(options.traceId, options.spanId);
  }
  return activeSpan ?? undefined;
}

function emitScoreLogEvent(eventAttributes: Attributes, targetSpan: Span): boolean {
  if (eventsDisabled() || !Events.logger) {
    return false;
  }
  Events.logger.emit({
    eventName: SemanticConvention.GEN_AI_EVALUATION_RESULT,
    context: trace.setSpan(otelContext.active(), targetSpan),
    severityNumber: SeverityNumber.INFO,
    severityText: 'INFO',
    body: SemanticConvention.GEN_AI_EVALUATION_RESULT,
    attributes: {
      ...eventAttributes,
      'event.name': SemanticConvention.GEN_AI_EVALUATION_RESULT,
    },
  });
  return true;
}

export function logScore(options: LogScoreOptions): boolean {
  const { name, value, comment, idempotencyKey, metadata } = options;
  if (!name) {
    throw new Error('name is required');
  }

  const targetSpan = resolveTargetSpan(options);
  if (!targetSpan) {
    return false;
  }

  const eventAttributes: Attributes = {
    [SemanticConvention.GEN_AI_EVALUATION_NAME]: name,
    ...normalizeScoreValue(value),
  };
  if (comment) {
    eventAttributes[SemanticConvention.GEN_AI_EVALUATION_EXPLANATION] = comment;
  }
  if (idempotencyKey) {
    eventAttributes[SemanticConvention.OPENLIT_SCORE_IDEMPOTENCY_KEY] = idempotencyKey;
  }
  mergeMetadata(eventAttributes, metadata);
  mergeCustomEventAttributes(eventAttributes);

  let emitted = false;
  if (targetSpan.isRecording()) {
    targetSpan.addEvent(SemanticConvention.GEN_AI_EVALUATION_RESULT, eventAttributes);
    emitted = true;
  }

  if (emitScoreLogEvent(eventAttributes, targetSpan)) {
    emitted = true;
  }

  return emitted;
}
