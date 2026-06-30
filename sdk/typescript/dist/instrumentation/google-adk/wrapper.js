"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentCreationRegistry = void 0;
exports.wrapAgentInit = wrapAgentInit;
exports.wrapRunnerRun = wrapRunnerRun;
exports.wrapRunnerRunAsync = wrapRunnerRunAsync;
exports.wrapAgentRunAsync = wrapAgentRunAsync;
const api_1 = require("@opentelemetry/api");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importStar(require("../../helpers"));
const utils_1 = require("./utils");
// ---------------------------------------------------------------------------
// Agent Creation Registry (mirrors Python _AgentCreationRegistry)
// ---------------------------------------------------------------------------
class AgentCreationRegistry {
    constructor() {
        this._contexts = new Map();
    }
    register(agentName, spanContext) {
        this._contexts.set(agentName, spanContext);
    }
    get(agentName) {
        return this._contexts.get(agentName);
    }
    getAll() {
        return Array.from(this._contexts.values());
    }
}
exports.AgentCreationRegistry = AgentCreationRegistry;
// ---------------------------------------------------------------------------
// Agent init wrapper (mirrors Python _wrap_agent_init)
// ---------------------------------------------------------------------------
function truncateContent(str, maxLen) {
    const limit = maxLen ?? config_1.default.maxContentLength;
    if (limit && str.length > limit)
        return str.slice(0, limit) + '...';
    return str;
}
function wrapAgentInit(tracer, registry) {
    return (originalMethod) => {
        return function (...args) {
            const result = originalMethod.apply(this, args);
            try {
                const name = this.name ?? 'agent';
                const spanName = `create_agent ${name}`;
                const captureContent = config_1.default.captureMessageContent ?? true;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_GOOGLE_ADK,
                    },
                });
                api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, String(name));
                    const description = this.description;
                    if (description) {
                        span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_DESCRIPTION, String(description));
                    }
                    const model = this.model;
                    if (model) {
                        const modelStr = (0, utils_1.resolveModelString)(model) ?? String(model);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, modelStr);
                    }
                    const instruction = this.instruction;
                    if (instruction && captureContent) {
                        const instrStr = String(instruction);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, JSON.stringify([{ type: 'text', content: truncateContent(instrStr) }]));
                    }
                    const tools = this.tools;
                    if (tools && Array.isArray(tools)) {
                        const toolDefs = [];
                        for (const t of tools.slice(0, 20)) {
                            const tName = t?.name ?? t?.constructor?.name ?? 'unknown';
                            const entry = { type: 'function', name: String(tName) };
                            const tDesc = t?.description;
                            if (tDesc)
                                entry.description = truncateContent(String(tDesc));
                            toolDefs.push(entry);
                        }
                        span.setAttribute(semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS, JSON.stringify(toolDefs));
                    }
                    const subAgents = this.sub_agents ?? this.subAgents;
                    if (subAgents && Array.isArray(subAgents)) {
                        const handoffNames = subAgents.slice(0, 20).map((sa) => String(sa?.name ?? 'unknown'));
                        span.setAttribute('gen_ai.agent.handoffs', JSON.stringify(handoffNames));
                    }
                    span.setStatus({ code: api_1.SpanStatusCode.OK });
                    (0, helpers_1.applyCustomSpanAttributes)(span);
                    const creationCtx = span.spanContext();
                    this._openlit_creation_context = creationCtx;
                    registry.register(String(name), creationCtx);
                    span.end();
                });
            }
            catch (e) {
                // Silently ignore instrumentation errors
            }
            return result;
        };
    };
}
// ---------------------------------------------------------------------------
// Runner.run wrapper — sync (mirrors Python sync_runner_wrap)
// ---------------------------------------------------------------------------
function wrapRunnerRun(tracer, endpoint, registry) {
    return (originalMethod) => {
        return function (...args) {
            const operationType = (0, utils_1.getOperationType)(endpoint);
            const spanKind = (0, utils_1.getSpanKind)(operationType);
            const spanName = (0, utils_1.generateSpanName)(endpoint, this);
            const links = [];
            const allContexts = registry.getAll();
            for (const ctx of allContexts)
                links.push({ context: ctx, attributes: {} });
            const span = tracer.startSpan(spanName, {
                kind: spanKind,
                links,
                attributes: {
                    [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
                    [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_GOOGLE_ADK,
                },
            });
            return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                const startTime = Date.now();
                const captureContent = config_1.default.captureMessageContent ?? true;
                const kwargs = args[args.length - 1];
                const sessionId = typeof kwargs === 'object' ? (kwargs?.session_id ?? kwargs?.sessionId) : undefined;
                if (sessionId)
                    span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, String(sessionId));
                (0, helpers_1.setFrameworkLlmActive)();
                (0, helpers_1.setFrameworkParentContext)(api_1.context.active());
                return utils_1.adkWorkflowActive.run(true, () => {
                    try {
                        const response = originalMethod.apply(this, args);
                        if (response && typeof response.then === 'function') {
                            return response
                                .then((res) => {
                                (0, utils_1.processGoogleAdkResponse)(span, endpoint, this, startTime, captureContent);
                                span.end();
                                return res;
                            })
                                .catch((e) => {
                                helpers_1.default.handleException(span, e);
                                span.end();
                                throw e;
                            })
                                .finally(() => {
                                (0, helpers_1.resetFrameworkLlmActive)();
                                (0, helpers_1.clearFrameworkParentContext)();
                            });
                        }
                        (0, utils_1.processGoogleAdkResponse)(span, endpoint, this, startTime, captureContent);
                        span.end();
                        (0, helpers_1.resetFrameworkLlmActive)();
                        (0, helpers_1.clearFrameworkParentContext)();
                        return response;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        span.end();
                        (0, helpers_1.resetFrameworkLlmActive)();
                        (0, helpers_1.clearFrameworkParentContext)();
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
function wrapRunnerRunAsync(tracer, endpoint, registry) {
    return (originalMethod) => {
        return function (...args) {
            if ((0, utils_1.isAdkWorkflowActive)())
                return originalMethod.apply(this, args);
            const operationType = (0, utils_1.getOperationType)(endpoint);
            const spanKind = (0, utils_1.getSpanKind)(operationType);
            const spanName = (0, utils_1.generateSpanName)(endpoint, this);
            const links = [];
            const allContexts = registry.getAll();
            for (const ctx of allContexts)
                links.push({ context: ctx, attributes: {} });
            const span = tracer.startSpan(spanName, {
                kind: spanKind,
                links,
                attributes: {
                    [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
                    [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_GOOGLE_ADK,
                },
            });
            // eslint-disable-next-line @typescript-eslint/no-this-alias -- preserve `this` for originalMethod.apply
            const self = this;
            const captureContent = config_1.default.captureMessageContent ?? true;
            const startTime = Date.now();
            const kwargs = args[args.length - 1];
            const sessionId = typeof kwargs === 'object' ? (kwargs?.session_id ?? kwargs?.sessionId) : undefined;
            if (sessionId)
                span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, String(sessionId));
            const generator = originalMethod.apply(self, args);
            if (generator && typeof generator[Symbol.asyncIterator] === 'function') {
                return wrapAsyncGenerator(generator, span, self, endpoint, startTime, captureContent);
            }
            if (generator && typeof generator.then === 'function') {
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    (0, helpers_1.setFrameworkLlmActive)();
                    (0, helpers_1.setFrameworkParentContext)(api_1.context.active());
                    return generator
                        .then((res) => {
                        (0, utils_1.processGoogleAdkResponse)(span, endpoint, self, startTime, captureContent);
                        span.end();
                        return res;
                    })
                        .catch((e) => {
                        helpers_1.default.handleException(span, e);
                        span.end();
                        throw e;
                    })
                        .finally(() => {
                        (0, helpers_1.resetFrameworkLlmActive)();
                        (0, helpers_1.clearFrameworkParentContext)();
                    });
                });
            }
            (0, utils_1.processGoogleAdkResponse)(span, endpoint, self, startTime, captureContent);
            span.end();
            return generator;
        };
    };
}
function wrapAsyncGenerator(generator, span, instance, endpoint, startTime, captureContent) {
    const originalIterator = generator[Symbol.asyncIterator].bind(generator);
    return {
        [Symbol.asyncIterator]() {
            const iter = originalIterator();
            return {
                async next() {
                    return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                        (0, helpers_1.setFrameworkLlmActive)();
                        (0, helpers_1.setFrameworkParentContext)(api_1.context.active());
                        try {
                            const result = await iter.next();
                            if (result.done) {
                                (0, utils_1.processGoogleAdkResponse)(span, endpoint, instance, startTime, captureContent);
                                span.end();
                                return result;
                            }
                            const event = result.value;
                            if (event && typeof event.is_final_response === 'function' && event.is_final_response()) {
                                (0, utils_1.captureEventOutput)(span, event, captureContent);
                            }
                            return result;
                        }
                        catch (e) {
                            helpers_1.default.handleException(span, e);
                            span.end();
                            throw e;
                        }
                        finally {
                            (0, helpers_1.resetFrameworkLlmActive)();
                            (0, helpers_1.clearFrameworkParentContext)();
                        }
                    });
                },
                async return(value) {
                    (0, helpers_1.resetFrameworkLlmActive)();
                    (0, helpers_1.clearFrameworkParentContext)();
                    (0, utils_1.processGoogleAdkResponse)(span, endpoint, instance, startTime, captureContent);
                    span.end();
                    return iter.return ? iter.return(value) : { done: true, value };
                },
                async throw(e) {
                    (0, helpers_1.resetFrameworkLlmActive)();
                    (0, helpers_1.clearFrameworkParentContext)();
                    helpers_1.default.handleException(span, e);
                    span.end();
                    return iter.throw ? iter.throw(e) : { done: true, value: undefined };
                },
            };
        },
    };
}
// ---------------------------------------------------------------------------
// BaseAgent.run_async wrapper — async generator (mirrors Python async_agent_wrap)
// ---------------------------------------------------------------------------
function wrapAgentRunAsync(tracer, endpoint, registry) {
    return (originalMethod) => {
        return function (...args) {
            const operationType = (0, utils_1.getOperationType)(endpoint);
            const spanKind = (0, utils_1.getSpanKind)(operationType);
            const spanName = (0, utils_1.generateSpanName)(endpoint, this);
            const links = [];
            const agentName = this.name;
            if (agentName) {
                const creationCtx = registry.get(String(agentName));
                if (creationCtx)
                    links.push({ context: creationCtx, attributes: {} });
            }
            const span = tracer.startSpan(spanName, {
                kind: spanKind,
                links,
                attributes: {
                    [semantic_convention_1.default.GEN_AI_OPERATION]: operationType,
                    [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_GOOGLE_ADK,
                },
            });
            // eslint-disable-next-line @typescript-eslint/no-this-alias -- preserve `this` for originalMethod.apply
            const self = this;
            const captureContent = config_1.default.captureMessageContent ?? true;
            const startTime = Date.now();
            // Extract session_id from ctx argument (first arg)
            const ctx = args[0];
            if (ctx) {
                const session = ctx.session;
                if (session) {
                    const sid = session.id;
                    if (sid)
                        span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, String(sid));
                }
            }
            const generator = originalMethod.apply(self, args);
            if (generator && typeof generator[Symbol.asyncIterator] === 'function') {
                return wrapAsyncGenerator(generator, span, self, endpoint, startTime, captureContent);
            }
            if (generator && typeof generator.then === 'function') {
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    (0, helpers_1.setFrameworkLlmActive)();
                    (0, helpers_1.setFrameworkParentContext)(api_1.context.active());
                    return generator
                        .then((res) => {
                        (0, utils_1.processGoogleAdkResponse)(span, endpoint, self, startTime, captureContent);
                        span.end();
                        return res;
                    })
                        .catch((e) => {
                        helpers_1.default.handleException(span, e);
                        span.end();
                        throw e;
                    })
                        .finally(() => {
                        (0, helpers_1.resetFrameworkLlmActive)();
                        (0, helpers_1.clearFrameworkParentContext)();
                    });
                });
            }
            (0, utils_1.processGoogleAdkResponse)(span, endpoint, self, startTime, captureContent);
            span.end();
            return generator;
        };
    };
}
//# sourceMappingURL=wrapper.js.map