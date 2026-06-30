/**
 * OpenAI Agents utilities for OTel GenAI semantic convention compliant telemetry.
 *
 * Maps SDK span types to OTel operation names, determines SpanKind,
 * generates span names, and sets type-specific attributes on OTel spans.
 *
 * All attribute setting happens at on_span_end (when span data is fully
 * populated), matching the Python SDK pattern.
 */
import { Span as OtelSpan, SpanKind } from '@opentelemetry/api';
export declare function getOperationType(spanType: string): string;
export declare function getSpanKind(operationType: string): SpanKind;
export declare function generateSpanName(spanData: any): string;
/**
 * Set all OTel-compliant attributes on the OTel span using fully-populated SDK data.
 * Called from on_span_end in the processor.
 */
export declare function processSpanEnd(otelSpan: OtelSpan, sdkSpan: any, startTime: number, conversationId: string | null, handoffTracker: Map<string, string>): void;
export declare function recordMetrics(operationType: string, durationSeconds: number, requestModel: string | null): void;
export declare function extractModelFromSpanData(spanData: any): string | null;
