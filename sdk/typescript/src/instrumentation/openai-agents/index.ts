/**
 * OpenLIT OpenAI Agents Instrumentation
 *
 * Registers an OpenLITTracingProcessor with the @openai/agents SDK's
 * tracing system, and wraps Agent construction to emit create_agent spans.
 * Mirrors the Python SDK instrumentation in
 * sdk/python/src/openlit/instrumentation/openai_agents/.
 */

import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { SpanContext, SpanKind, trace, context as otelContext } from '@opentelemetry/api';

import { INSTRUMENTATION_PREFIX } from '../../constant';
import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import { applyCustomSpanAttributes } from '../../helpers';
import { OpenLITTracingProcessor, AgentCreationRegistry } from './processor';

// Minimum supported version of @openai/agents
const SUPPORTED_VERSIONS = ['>=0.0.3'];

class AgentCreationRegistryImpl implements AgentCreationRegistry {
  private _contexts = new Map<string, SpanContext>();

  register(agentName: string, spanContext: SpanContext): void {
    this._contexts.set(agentName, spanContext);
  }

  get(agentName: string): SpanContext | undefined {
    return this._contexts.get(agentName);
  }
}

export default class OpenAIAgentsInstrumentation extends InstrumentationBase {
  private _processor: OpenLITTracingProcessor | null = null;
  private _registry = new AgentCreationRegistryImpl();

  constructor(config: InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-openai-agents`, '1.0.0', config);
  }

  protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void {
    const agentsModule = new InstrumentationNodeModuleDefinition(
      '@openai/agents',
      SUPPORTED_VERSIONS,
      (moduleExports: any) => {
        this._patch(moduleExports);
        return moduleExports;
      },
      (moduleExports: any) => {
        this._unpatch(moduleExports);
        return moduleExports;
      },
    );
    return agentsModule;
  }

  public manualPatch(moduleExports: any): void {
    this._patch(moduleExports);
  }

  private _patch(moduleExports: any): void {
    try {
      const tracer = this.tracer;

      // Create processor and register with the agents SDK
      this._processor = new OpenLITTracingProcessor(tracer, this._registry);

      // Try set_trace_processors first (replaces default), fall back to addTraceProcessor
      if (typeof moduleExports.setTraceProcessors === 'function') {
        moduleExports.setTraceProcessors([this._processor]);
      } else if (typeof moduleExports.addTraceProcessor === 'function') {
        moduleExports.addTraceProcessor(this._processor);
      }

      // Wrap Agent constructor to emit create_agent spans
      const AgentClass = moduleExports.Agent;
      if (AgentClass && typeof AgentClass === 'function') {
        this._wrapAgentConstructor(moduleExports, tracer);
      }
    } catch {
      // Module may not be installed -- silently skip
    }
  }

  private _wrapAgentConstructor(moduleExports: any, tracer: ReturnType<typeof trace.getTracer>): void {
    const registry = this._registry;
    const OriginalAgent = moduleExports.Agent;

    if (!OriginalAgent || typeof OriginalAgent !== 'function') return;

    const captureContent = OpenlitConfig.captureMessageContent ?? true;

    const patchedAgent = function (this: any, ...args: any[]) {
      // Call original constructor
      const instance = new OriginalAgent(...args);

      try {
        const config = args[0] ?? {};
        const name = instance.name ?? config.name ?? 'agent';
        const spanName = `create_agent ${name}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
          },
        });

        span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, String(name));
        span.setAttribute(SemanticConvention.GEN_AI_AGENT_ID, String(Math.random().toString(36).slice(2)));

        const model = instance.model ?? config.model;
        if (model) {
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, String(model));
        }

        const instructions = instance.instructions ?? config.instructions;
        if (instructions && captureContent) {
          const formatted = typeof instructions === 'string'
            ? JSON.stringify([{ type: 'text', content: instructions }])
            : JSON.stringify([{ type: 'text', content: String(instructions) }]);
          span.setAttribute(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS, formatted);
        }

        const tools = instance.tools ?? config.tools;
        if (tools && Array.isArray(tools) && tools.length > 0) {
          const toolDefs = tools.slice(0, 20).map((t: any) => {
            const tName = t.name ?? t.__name__ ?? String(t);
            return { type: 'function', name: String(tName) };
          });
          span.setAttribute(SemanticConvention.GEN_AI_TOOL_DEFINITIONS, JSON.stringify(toolDefs));
        }

        const handoffs = instance.handoffs ?? config.handoffs;
        if (handoffs && Array.isArray(handoffs) && handoffs.length > 0) {
          const handoffNames = handoffs.slice(0, 20).map((h: any) => {
            const hName = h.name ?? String(h);
            return String(hName);
          });
          span.setAttribute('gen_ai.agent.handoffs', JSON.stringify(handoffNames));
        }

        span.setAttribute(
          SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT,
          OpenlitConfig.environment ?? 'default',
        );
        span.setAttribute(
          SemanticConvention.GEN_AI_APPLICATION_NAME,
          OpenlitConfig.applicationName ?? 'default',
        );

        applyCustomSpanAttributes(span);

        // Store span context in registry for later Links from invoke_agent spans
        const creationCtx = span.spanContext();
        registry.register(String(name), creationCtx);

        span.end();
      } catch {
        // Swallow to avoid breaking agent construction
      }

      return instance;
    };

    // Preserve prototype chain and static properties
    Object.setPrototypeOf(patchedAgent, OriginalAgent);
    patchedAgent.prototype = OriginalAgent.prototype;
    Object.defineProperty(patchedAgent, 'name', { value: OriginalAgent.name });

    // ESM-to-CJS interop may define exports as getter-only properties;
    // both defineProperty and assignment may fail for ESM Module Namespace objects.
    try {
      Object.defineProperty(moduleExports, 'Agent', {
        enumerable: true,
        configurable: true,
        writable: true,
        value: patchedAgent,
      });
    } catch {
      try { moduleExports.Agent = patchedAgent; } catch { /* strict mode throws */ }
    }
  }

  private _unpatch(moduleExports: any): void {
    try {
      if (this._processor) {
        // Try to clear processors
        if (typeof moduleExports?.setTraceProcessors === 'function') {
          moduleExports.setTraceProcessors([]);
        }
        this._processor = null;
      }
    } catch {
      // ignore
    }
  }
}
