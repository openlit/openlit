/**
 * Strands Agents SpanProcessor.
 *
 * Enriches Strands' native OTel spans with OpenLIT-specific attributes,
 * extracts content from span events into span attributes, emits
 * gen_ai.client.inference.operation.details log events for chat spans,
 * and records OpenLIT metrics.
 *
 * Provider-level chat spans (OpenAI, Anthropic, etc.) are suppressed
 * when they occur inside a Strands chat span via the shared
 * frameworkLlmActive flag.
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/strands/processor.py
 */
import { Context } from '@opentelemetry/api';
import type { SpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { Span } from '@opentelemetry/api';
/**
 * Enriches Strands-generated spans with OpenLIT telemetry.
 * Added to the TracerProvider so it receives all spans; non-Strands
 * spans are ignored via the _isStrandsSpan() check.
 */
export declare class StrandsSpanProcessor implements SpanProcessor {
    private _strandsVersion;
    private _chatSpanIds;
    private _chatInfo;
    constructor(strandsVersion?: string);
    private static _isStrandsSpan;
    private static _setAttr;
    private static _setAttrs;
    private static _setSpanName;
    onStart(span: Span, _parentContext: Context): void;
    onEnd(span: ReadableSpan): void;
    shutdown(): Promise<void>;
    forceFlush(): Promise<void>;
    private _processSpan;
    private _setOtelCompliantSpanName;
    private _enrichChatSpan;
    private _storeChatInfoForParent;
    private _enrichAgentFromChildren;
    private static _extractResponseId;
    private static _extractToolCallIdFromSpanEvents;
    private _extractAndSetContent;
    private _emitChatInferenceEvent;
    /**
     * Compute and write `openlit.agent.version_hash` (auto) and
     * `gen_ai.agent.version` (user override) onto a Strands chat span.
     * Returns the same attributes for inclusion in the inference event.
     */
    private _stampChatAgentVersion;
}
