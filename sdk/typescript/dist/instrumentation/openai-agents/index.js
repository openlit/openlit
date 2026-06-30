"use strict";
/**
 * OpenLIT OpenAI Agents Instrumentation
 *
 * Registers an OpenLITTracingProcessor with the @openai/agents SDK's
 * tracing system, and wraps Agent construction to emit create_agent spans.
 * Mirrors the Python SDK instrumentation in
 * sdk/python/src/openlit/instrumentation/openai_agents/.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const api_1 = require("@opentelemetry/api");
const constant_1 = require("../../constant");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = require("../../helpers");
const processor_1 = require("./processor");
// Minimum supported version of @openai/agents
const SUPPORTED_VERSIONS = ['>=0.0.3'];
class AgentCreationRegistryImpl {
    constructor() {
        this._contexts = new Map();
    }
    register(agentName, spanContext) {
        this._contexts.set(agentName, spanContext);
    }
    get(agentName) {
        return this._contexts.get(agentName);
    }
}
class OpenAIAgentsInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-openai-agents`, '1.0.0', config);
        this._processor = null;
        this._registry = new AgentCreationRegistryImpl();
    }
    init() {
        const agentsModule = new instrumentation_1.InstrumentationNodeModuleDefinition('@openai/agents', SUPPORTED_VERSIONS, (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            this._unpatch(moduleExports);
            return moduleExports;
        });
        return agentsModule;
    }
    manualPatch(moduleExports) {
        this._patch(moduleExports);
    }
    _patch(moduleExports) {
        try {
            const tracer = this.tracer;
            // Create processor and register with the agents SDK
            this._processor = new processor_1.OpenLITTracingProcessor(tracer, this._registry);
            // Try set_trace_processors first (replaces default), fall back to addTraceProcessor
            if (typeof moduleExports.setTraceProcessors === 'function') {
                moduleExports.setTraceProcessors([this._processor]);
            }
            else if (typeof moduleExports.addTraceProcessor === 'function') {
                moduleExports.addTraceProcessor(this._processor);
            }
            // Wrap Agent constructor to emit create_agent spans
            const AgentClass = moduleExports.Agent;
            if (AgentClass && typeof AgentClass === 'function') {
                this._wrapAgentConstructor(moduleExports, tracer);
            }
        }
        catch {
            // Module may not be installed -- silently skip
        }
    }
    _wrapAgentConstructor(moduleExports, tracer) {
        const registry = this._registry;
        const OriginalAgent = moduleExports.Agent;
        if (!OriginalAgent || typeof OriginalAgent !== 'function')
            return;
        const captureContent = config_1.default.captureMessageContent ?? true;
        const patchedAgent = function (...args) {
            // Call original constructor
            const instance = new OriginalAgent(...args);
            try {
                const config = args[0] ?? {};
                const name = instance.name ?? config.name ?? 'agent';
                const spanName = `create_agent ${name}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_OPENAI,
                    },
                });
                span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, String(name));
                span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_ID, String(Math.random().toString(36).slice(2)));
                const model = instance.model ?? config.model;
                if (model) {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, String(model));
                }
                const instructions = instance.instructions ?? config.instructions;
                if (instructions && captureContent) {
                    const formatted = typeof instructions === 'string'
                        ? JSON.stringify([{ type: 'text', content: instructions }])
                        : JSON.stringify([{ type: 'text', content: String(instructions) }]);
                    span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, formatted);
                }
                const tools = instance.tools ?? config.tools;
                if (tools && Array.isArray(tools) && tools.length > 0) {
                    const toolDefs = tools.slice(0, 20).map((t) => {
                        const tName = t.name ?? t.__name__ ?? String(t);
                        return { type: 'function', name: String(tName) };
                    });
                    span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, JSON.stringify(toolDefs));
                }
                const handoffs = instance.handoffs ?? config.handoffs;
                if (handoffs && Array.isArray(handoffs) && handoffs.length > 0) {
                    const handoffNames = handoffs.slice(0, 20).map((h) => {
                        const hName = h.name ?? String(h);
                        return String(hName);
                    });
                    span.setAttribute('gen_ai.agent.handoffs', JSON.stringify(handoffNames));
                }
                span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment ?? 'default');
                span.setAttribute(semantic_convention_1.default.GEN_AI_APPLICATION_NAME, config_1.default.applicationName ?? 'default');
                (0, helpers_1.applyCustomSpanAttributes)(span);
                // Store span context in registry for later Links from invoke_agent spans
                const creationCtx = span.spanContext();
                registry.register(String(name), creationCtx);
                span.end();
            }
            catch {
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
        }
        catch {
            try {
                moduleExports.Agent = patchedAgent;
            }
            catch { /* strict mode throws */ }
        }
    }
    _unpatch(moduleExports) {
        try {
            if (this._processor) {
                // Try to clear processors
                if (typeof moduleExports?.setTraceProcessors === 'function') {
                    moduleExports.setTraceProcessors([]);
                }
                this._processor = null;
            }
        }
        catch {
            // ignore
        }
    }
}
exports.default = OpenAIAgentsInstrumentation;
//# sourceMappingURL=index.js.map