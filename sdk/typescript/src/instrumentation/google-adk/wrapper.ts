import {
  Tracer,
  SpanKind,
  SpanContext,
  context,
  trace,
  Link,
  SpanStatusCode,
} from '@opentelemetry/api';
import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  applyCustomSpanAttributes,
  setFrameworkLlmActive,
  resetFrameworkLlmActive,
  setFrameworkParentContext,
  clearFrameworkParentContext,
} from '../../helpers';
import {
  adkWorkflowActive,
  isAdkWorkflowActive,
  getOperationType,
  getSpanKind,
  generateSpanName,
  resolveModelString,
  processGoogleAdkResponse,
  captureEventOutput,
  recordGoogleAdkMetrics,
  extractModelName,
  resolveServerInfo,
} from './utils';

// ---------------------------------------------------------------------------
// Agent Creation Registry (mirrors Python _AgentCreationRegistry)
// ---------------------------------------------------------------------------

export class AgentCreationRegistry {
  private _contexts = new Map<string, SpanContext>();

  register(agentName: string, spanContext: SpanContext): void {
    this._contexts.set(agentName, spanContext);
  }

  get(agentName: string): SpanContext | undefined {
    return this._contexts.get(agentName);
  }

  getAll(): SpanContext[] {
    return Array.from(this._contexts.values());
  }
}

// ---------------------------------------------------------------------------
// Agent init wrapper (mirrors Python _wrap_agent_init)
// ---------------------------------------------------------------------------

function truncateContent(str: string, maxLen?: number | null): string {
  const limit = maxLen ?? OpenlitConfig.maxContentLength;
  if (limit && str.length > limit) return str.slice(0, limit) + '...';
  return str;
}

export function wrapAgentInit(tracer: Tracer, registry: AgentCreationRegistry) {
  return (originalMethod: (...args: any[]) => any) => {
    return function (this: any, ...args: any[]) {
      const result = originalMethod.apply(this, args);

      try {
        const name = this.name ?? 'agent';
        const spanName = `create_agent ${name}`;
        const captureContent = OpenlitConfig.captureMessageContent ?? true;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK,
          },
        });

        context.with(trace.setSpan(context.active(), span), () => {
          span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, String(name));

          const description = this.description;
          if (description) {
            span.setAttribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, String(description));
          }

          const model = this.model;
          if (model) {
            const modelStr = resolveModelString(model) ?? String(model);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, modelStr);
          }

          const instruction = this.instruction;
          if (instruction && captureContent) {
            const instrStr = String(instruction);
            span.setAttribute(
              SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
              JSON.stringify([{ type: 'text', content: truncateContent(instrStr) }])
            );
          }

          const tools = this.tools;
          if (tools && Array.isArray(tools)) {
            const toolDefs: any[] = [];
            for (const t of tools.slice(0, 20)) {
              const tName = t?.name ?? t?.constructor?.name ?? 'unknown';
              const entry: any = { type: 'function', name: String(tName) };
              const tDesc = t?.description;
              if (tDesc) entry.description = truncateContent(String(tDesc));
              toolDefs.push(entry);
            }
            span.setAttribute(SemanticConvention.GEN_AI_TOOL_DEFINITIONS, JSON.stringify(toolDefs));
          }

          const subAgents = this.sub_agents ?? this.subAgents;
          if (subAgents && Array.isArray(subAgents)) {
            const handoffNames = subAgents.slice(0, 20).map(
              (sa: any) => String(sa?.name ?? 'unknown')
            );
            span.setAttribute('gen_ai.agent.handoffs', JSON.stringify(handoffNames));
          }

          span.setStatus({ code: SpanStatusCode.OK });
          applyCustomSpanAttributes(span);

          const creationCtx = span.spanContext();
          this._openlit_creation_context = creationCtx;
          registry.register(String(name), creationCtx);

          span.end();
        });
      } catch (e: any) {
        // Silently ignore instrumentation errors
      }

      return result;
    };
  };
}

// ---------------------------------------------------------------------------
// Runner.run wrapper — sync (mirrors Python sync_runner_wrap)
// ---------------------------------------------------------------------------

export function wrapRunnerRun(
  tracer: Tracer,
  endpoint: string,
  registry: AgentCreationRegistry,
) {
  return (originalMethod: (...args: any[]) => any) => {
    return function (this: any, ...args: any[]) {
      const operationType = getOperationType(endpoint);
      const spanKind = getSpanKind(operationType);
      const spanName = generateSpanName(endpoint, this);

      const links: Link[] = [];
      const allContexts = registry.getAll();
      for (const ctx of allContexts) links.push({ context: ctx, attributes: {} });

      const span = tracer.startSpan(spanName, {
        kind: spanKind,
        links,
        attributes: {
          [SemanticConvention.GEN_AI_OPERATION]: operationType,
          [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK,
        },
      });

      return context.with(trace.setSpan(context.active(), span), () => {
        const startTime = Date.now();
        const captureContent = OpenlitConfig.captureMessageContent ?? true;

        const kwargs = args[args.length - 1];
        const sessionId = typeof kwargs === 'object' ? (kwargs?.session_id ?? kwargs?.sessionId) : undefined;
        if (sessionId) span.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, String(sessionId));

        setFrameworkLlmActive();
        setFrameworkParentContext(context.active());

        return adkWorkflowActive.run(true, () => {
          try {
            const response = originalMethod.apply(this, args);

            if (response && typeof response.then === 'function') {
              return response
                .then((res: any) => {
                  processGoogleAdkResponse(span, endpoint, this, startTime, captureContent);
                  span.end();
                  return res;
                })
                .catch((e: any) => {
                  OpenLitHelper.handleException(span, e);
                  span.end();
                  throw e;
                })
                .finally(() => {
                  resetFrameworkLlmActive();
                  clearFrameworkParentContext();
                });
            }

            processGoogleAdkResponse(span, endpoint, this, startTime, captureContent);
            span.end();
            resetFrameworkLlmActive();
            clearFrameworkParentContext();
            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            span.end();
            resetFrameworkLlmActive();
            clearFrameworkParentContext();
            throw e;
          }
        });
      });
    };
  };
}

// ---------------------------------------------------------------------------
// Runner.run_async wrapper — async generator (mirrors Python async_runner_wrap)
// ---------------------------------------------------------------------------

export function wrapRunnerRunAsync(
  tracer: Tracer,
  endpoint: string,
  registry: AgentCreationRegistry,
) {
  return (originalMethod: (...args: any[]) => any) => {
    return function (this: any, ...args: any[]) {
      if (isAdkWorkflowActive()) return originalMethod.apply(this, args);

      const operationType = getOperationType(endpoint);
      const spanKind = getSpanKind(operationType);
      const spanName = generateSpanName(endpoint, this);

      const links: Link[] = [];
      const allContexts = registry.getAll();
      for (const ctx of allContexts) links.push({ context: ctx, attributes: {} });

      const span = tracer.startSpan(spanName, {
        kind: spanKind,
        links,
        attributes: {
          [SemanticConvention.GEN_AI_OPERATION]: operationType,
          [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK,
        },
      });

      const self = this;
      const captureContent = OpenlitConfig.captureMessageContent ?? true;
      const startTime = Date.now();

      const kwargs = args[args.length - 1];
      const sessionId = typeof kwargs === 'object' ? (kwargs?.session_id ?? kwargs?.sessionId) : undefined;
      if (sessionId) span.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, String(sessionId));

      const generator = originalMethod.apply(self, args);

      if (generator && typeof generator[Symbol.asyncIterator] === 'function') {
        return wrapAsyncGenerator(generator, span, self, endpoint, startTime, captureContent);
      }

      if (generator && typeof generator.then === 'function') {
        return context.with(trace.setSpan(context.active(), span), () => {
          setFrameworkLlmActive();
          setFrameworkParentContext(context.active());
          return generator
            .then((res: any) => {
              processGoogleAdkResponse(span, endpoint, self, startTime, captureContent);
              span.end();
              return res;
            })
            .catch((e: any) => {
              OpenLitHelper.handleException(span, e);
              span.end();
              throw e;
            })
            .finally(() => {
              resetFrameworkLlmActive();
              clearFrameworkParentContext();
            });
        });
      }

      processGoogleAdkResponse(span, endpoint, self, startTime, captureContent);
      span.end();
      return generator;
    };
  };
}

function wrapAsyncGenerator(
  generator: AsyncIterable<any>,
  span: any,
  instance: any,
  endpoint: string,
  startTime: number,
  captureContent: boolean,
): AsyncIterable<any> {
  const originalIterator = generator[Symbol.asyncIterator].bind(generator);
  return {
    [Symbol.asyncIterator]() {
      const iter = originalIterator();
      return {
        async next() {
          return context.with(trace.setSpan(context.active(), span), async () => {
            setFrameworkLlmActive();
            setFrameworkParentContext(context.active());
            try {
              const result = await iter.next();
              if (result.done) {
                processGoogleAdkResponse(span, endpoint, instance, startTime, captureContent);
                span.end();
                return result;
              }
              const event = result.value;
              if (event && typeof event.is_final_response === 'function' && event.is_final_response()) {
                captureEventOutput(span, event, captureContent);
              }
              return result;
            } catch (e: any) {
              OpenLitHelper.handleException(span, e);
              span.end();
              throw e;
            } finally {
              resetFrameworkLlmActive();
              clearFrameworkParentContext();
            }
          });
        },
        async return(value?: any) {
          resetFrameworkLlmActive();
          clearFrameworkParentContext();
          processGoogleAdkResponse(span, endpoint, instance, startTime, captureContent);
          span.end();
          return iter.return ? iter.return(value) : { done: true as const, value };
        },
        async throw(e?: any) {
          resetFrameworkLlmActive();
          clearFrameworkParentContext();
          OpenLitHelper.handleException(span, e);
          span.end();
          return iter.throw ? iter.throw(e) : { done: true as const, value: undefined };
        },
      };
    },
  } as AsyncIterable<any>;
}

// ---------------------------------------------------------------------------
// BaseAgent.run_async wrapper — async generator (mirrors Python async_agent_wrap)
// ---------------------------------------------------------------------------

export function wrapAgentRunAsync(
  tracer: Tracer,
  endpoint: string,
  registry: AgentCreationRegistry,
) {
  return (originalMethod: (...args: any[]) => any) => {
    return function (this: any, ...args: any[]) {
      const operationType = getOperationType(endpoint);
      const spanKind = getSpanKind(operationType);
      const spanName = generateSpanName(endpoint, this);

      const links: Link[] = [];
      const agentName = this.name;
      if (agentName) {
        const creationCtx = registry.get(String(agentName));
        if (creationCtx) links.push({ context: creationCtx, attributes: {} });
      }

      const span = tracer.startSpan(spanName, {
        kind: spanKind,
        links,
        attributes: {
          [SemanticConvention.GEN_AI_OPERATION]: operationType,
          [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK,
        },
      });

      const self = this;
      const captureContent = OpenlitConfig.captureMessageContent ?? true;
      const startTime = Date.now();

      // Extract session_id from ctx argument (first arg)
      const ctx = args[0];
      if (ctx) {
        const session = ctx.session;
        if (session) {
          const sid = session.id;
          if (sid) span.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, String(sid));
        }
      }

      const generator = originalMethod.apply(self, args);

      if (generator && typeof generator[Symbol.asyncIterator] === 'function') {
        return wrapAsyncGenerator(generator, span, self, endpoint, startTime, captureContent);
      }

      if (generator && typeof generator.then === 'function') {
        return context.with(trace.setSpan(context.active(), span), () => {
          setFrameworkLlmActive();
          setFrameworkParentContext(context.active());
          return generator
            .then((res: any) => {
              processGoogleAdkResponse(span, endpoint, self, startTime, captureContent);
              span.end();
              return res;
            })
            .catch((e: any) => {
              OpenLitHelper.handleException(span, e);
              span.end();
              throw e;
            })
            .finally(() => {
              resetFrameworkLlmActive();
              clearFrameworkParentContext();
            });
        });
      }

      processGoogleAdkResponse(span, endpoint, self, startTime, captureContent);
      span.end();
      return generator;
    };
  };
}
