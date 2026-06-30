/**
 * OpenLIT OpenAI Agents TracingProcessor implementation.
 *
 * Integrates with the @openai/agents TracingProcessor interface.
 * All span data fields are read at onSpanEnd (when fully populated).
 * Compliant with OTel GenAI semantic conventions.
 */
import { SpanContext, trace } from '@opentelemetry/api';
export interface AgentCreationRegistry {
    register(agentName: string, spanContext: SpanContext): void;
    get(agentName: string): SpanContext | undefined;
}
/**
 * TracingProcessor that emits OTel GenAI-compliant spans from
 * the @openai/agents SDK tracing lifecycle.
 *
 * Thread-safe by design: each trace/span entry is keyed independently.
 * LLM span types (response, generation) are skipped -- the OpenAI
 * provider instrumentation handles those with richer telemetry.
 */
export declare class OpenLITTracingProcessor {
    private _tracer;
    private _agentCreationRegistry;
    private _otelSpans;
    private _rootSpans;
    private _traceGroupIds;
    private _handoffTracker;
    constructor(tracer: ReturnType<typeof trace.getTracer>, agentCreationRegistry?: AgentCreationRegistry | null);
    onTraceStart(sdkTrace: any): Promise<void>;
    onTraceEnd(sdkTrace: any): Promise<void>;
    onSpanStart(sdkSpan: any): Promise<void>;
    onSpanEnd(sdkSpan: any): Promise<void>;
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
}
