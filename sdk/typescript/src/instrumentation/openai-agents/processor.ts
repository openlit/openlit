/**
 * OpenLIT OpenAI Agents TracingProcessor implementation.
 *
 * Integrates with the @openai/agents TracingProcessor interface.
 * All span data fields are read at onSpanEnd (when fully populated).
 * Compliant with OTel GenAI semantic conventions.
 */

import {
  context as contextApi,
  Span as OtelSpan,
  SpanKind,
  SpanStatusCode,
  Link,
  SpanContext,
  trace,
} from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';

import SemanticConvention from '../../semantic-convention';
import { SDK_NAME, SDK_VERSION } from '../../constant';
import OpenlitConfig from '../../config';
import {
  applyCustomSpanAttributes,
  getServerAddressForProvider,
  setFrameworkParentContext,
  clearFrameworkParentContext,
} from '../../helpers';
import {
  getOperationType,
  getSpanKind,
  generateSpanName,
  processSpanEnd,
  recordMetrics,
} from './utils';

const [OPENAI_SERVER_ADDRESS, OPENAI_SERVER_PORT] = getServerAddressForProvider('openai');

const LLM_SPAN_TYPES = new Set(['response', 'generation']);

interface SpanEntry {
  otelSpan: OtelSpan;
  startTime: number;
}

interface TraceEntry {
  otelSpan: OtelSpan;
  startTime: number;
}

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
export class OpenLITTracingProcessor {
  private _tracer: ReturnType<typeof trace.getTracer>;
  private _agentCreationRegistry: AgentCreationRegistry | null;

  // SDK span_id -> SpanEntry
  private _otelSpans = new Map<string, SpanEntry>();
  // SDK trace_id -> TraceEntry
  private _rootSpans = new Map<string, TraceEntry>();
  // trace_id -> group_id (conversation id)
  private _traceGroupIds = new Map<string, string>();
  // Agent handoff tracker (bounded Map)
  private _handoffTracker = new Map<string, string>();

  constructor(
    tracer: ReturnType<typeof trace.getTracer>,
    agentCreationRegistry: AgentCreationRegistry | null = null,
  ) {
    this._tracer = tracer;
    this._agentCreationRegistry = agentCreationRegistry;
  }

  // ------------------------------------------------------------------
  // Trace lifecycle
  // ------------------------------------------------------------------
  async onTraceStart(sdkTrace: any): Promise<void> {
    try {
      const traceId: string = sdkTrace.traceId ?? 'unknown';
      const traceName: string = sdkTrace.name ?? 'workflow';
      const groupId: string | null = sdkTrace.groupId ?? null;

      const operation = SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK;
      const spanName = `${operation} ${traceName}`;

      const otelSpan = this._tracer.startSpan(spanName, {
        kind: SpanKind.INTERNAL,
        attributes: {
          [SemanticConvention.GEN_AI_OPERATION]: operation,
          [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
        },
      });

      const startTime = Date.now();
      this._rootSpans.set(traceId, { otelSpan, startTime });
      if (groupId) {
        this._traceGroupIds.set(traceId, String(groupId));
      }

      setFrameworkParentContext(trace.setSpan(contextApi.active(), otelSpan));
    } catch {
      // swallow
    }
  }

  async onTraceEnd(sdkTrace: any): Promise<void> {
    try {
      const traceId: string = sdkTrace.traceId ?? 'unknown';
      const traceName: string = sdkTrace.name ?? 'workflow';

      const entry = this._rootSpans.get(traceId);
      this._rootSpans.delete(traceId);
      const groupId = this._traceGroupIds.get(traceId) ?? null;
      this._traceGroupIds.delete(traceId);

      if (!entry) return;

      const { otelSpan, startTime } = entry;
      const endTime = Date.now();
      const durationMs = endTime - startTime;

      // Set common framework attributes
      otelSpan.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
      otelSpan.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
      otelSpan.setAttribute(
        SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL,
        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
      );
      otelSpan.setAttribute(
        SemanticConvention.GEN_AI_OPERATION,
        SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
      );
      if (OPENAI_SERVER_ADDRESS) {
        otelSpan.setAttribute(SemanticConvention.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
        if (OPENAI_SERVER_PORT) {
          otelSpan.setAttribute(SemanticConvention.SERVER_PORT, OPENAI_SERVER_PORT);
        }
      }
      otelSpan.setAttribute(
        SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT,
        OpenlitConfig.environment ?? 'default',
      );
      otelSpan.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName ?? 'default');
      otelSpan.setAttribute(
        SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
        durationMs / 1000,
      );
      otelSpan.setAttribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, traceName);

      if (groupId) {
        otelSpan.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, groupId);
      }

      applyCustomSpanAttributes(otelSpan);

      // Error handling
      const error = sdkTrace.error;
      if (error) {
        const errorType =
          typeof error === 'object' && error !== null
            ? (error as any).constructor?.name || (error as any).code || '_OTHER'
            : '_OTHER';
        const errorMsg =
          typeof error === 'object' && error !== null
            ? (error as any).message ?? String(error)
            : String(error);
        otelSpan.setAttribute(SemanticConvention.ERROR_TYPE, errorType);
        otelSpan.setStatus({ code: SpanStatusCode.ERROR, message: errorMsg });
      } else {
        otelSpan.setStatus({ code: SpanStatusCode.OK });
      }

      // Metrics
      if (!OpenlitConfig.disableMetrics) {
        recordMetrics(
          SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
          durationMs / 1000,
          null,
        );
      }

      otelSpan.end();
      clearFrameworkParentContext();
    } catch {
      // swallow
    }
  }

  // ------------------------------------------------------------------
  // Span lifecycle
  // ------------------------------------------------------------------
  async onSpanStart(sdkSpan: any): Promise<void> {
    try {
      const spanData = sdkSpan.spanData;
      const spanType: string = spanData?.type ?? 'unknown';

      // Skip LLM span types -- let the OpenAI provider instrumentation handle them
      if (LLM_SPAN_TYPES.has(spanType)) return;

      const traceId: string = sdkSpan.traceId ?? 'unknown';
      const sdkSpanId: string | null = sdkSpan.spanId ?? null;
      const parentSdkId: string | null = sdkSpan.parentId ?? null;

      const operation = getOperationType(spanType);
      const kind = getSpanKind(operation);
      const spanName = generateSpanName(spanData);

      // Find parent OTel span context
      let parentCtx = contextApi.active();
      if (parentSdkId && this._otelSpans.has(parentSdkId)) {
        const parentEntry = this._otelSpans.get(parentSdkId)!;
        parentCtx = trace.setSpan(contextApi.active(), parentEntry.otelSpan);
      } else if (this._rootSpans.has(traceId)) {
        const rootEntry = this._rootSpans.get(traceId)!;
        parentCtx = trace.setSpan(contextApi.active(), rootEntry.otelSpan);
      }

      // Span links: connect invoke_agent back to create_agent
      const links: Link[] = [];
      if (spanType === 'agent' && this._agentCreationRegistry) {
        const agentName = spanData.name;
        if (agentName) {
          const creationCtx = this._agentCreationRegistry.get(String(agentName));
          if (creationCtx) {
            links.push({ context: creationCtx, attributes: {} });
          }
        }
      }

      const otelSpan = this._tracer.startSpan(
        spanName,
        {
          kind,
          links,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operation,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
          },
        },
        parentCtx,
      );

      const startTime = Date.now();

      if (sdkSpanId) {
        this._otelSpans.set(sdkSpanId, { otelSpan, startTime });
      }

      setFrameworkParentContext(trace.setSpan(parentCtx, otelSpan));
    } catch {
      // swallow
    }
  }

  async onSpanEnd(sdkSpan: any): Promise<void> {
    try {
      const spanData = sdkSpan.spanData;
      const spanType: string = spanData?.type ?? 'unknown';

      // Skip LLM span types
      if (LLM_SPAN_TYPES.has(spanType)) return;

      const sdkSpanId: string | null = sdkSpan.spanId ?? null;
      const traceId: string = sdkSpan.traceId ?? 'unknown';

      if (!sdkSpanId) return;
      const entry = this._otelSpans.get(sdkSpanId);
      this._otelSpans.delete(sdkSpanId);
      if (!entry) return;

      const { otelSpan, startTime } = entry;
      const conversationId = this._traceGroupIds.get(traceId) ?? null;

      processSpanEnd(
        otelSpan,
        sdkSpan,
        startTime,
        conversationId,
        this._handoffTracker,
      );

      otelSpan.end();

      // Restore parent context so subsequent provider spans nest correctly
      const parentSdkId: string | null = sdkSpan.parentId ?? null;
      if (parentSdkId && this._otelSpans.has(parentSdkId)) {
        const parentEntry = this._otelSpans.get(parentSdkId)!;
        setFrameworkParentContext(trace.setSpan(contextApi.active(), parentEntry.otelSpan));
      } else if (this._rootSpans.has(traceId)) {
        const rootEntry = this._rootSpans.get(traceId)!;
        setFrameworkParentContext(trace.setSpan(contextApi.active(), rootEntry.otelSpan));
      }
    } catch {
      // swallow
    }
  }

  // ------------------------------------------------------------------
  // Lifecycle management
  // ------------------------------------------------------------------
  async forceFlush(): Promise<void> {
    try {
      for (const [, { otelSpan }] of this._otelSpans) {
        try { otelSpan.end(); } catch { /* ignore */ }
      }
      this._otelSpans.clear();

      for (const [, { otelSpan }] of this._rootSpans) {
        try { otelSpan.end(); } catch { /* ignore */ }
      }
      this._rootSpans.clear();
      this._traceGroupIds.clear();
    } catch {
      // swallow
    }
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
  }
}
