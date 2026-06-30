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
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importStar(require("../../helpers"));
const constant_1 = require("../../constant");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getGraphName(instance) {
    if (!instance)
        return 'graph';
    const name = instance.name;
    if (name)
        return String(name);
    const graphId = instance.graph_id ?? instance.graphId;
    if (graphId)
        return String(graphId);
    const className = instance.constructor?.name;
    if (className && !['Pregel', 'CompiledStateGraph', 'StateGraph'].includes(className)) {
        return className;
    }
    return 'graph';
}
function extractConfigInfo(config) {
    const info = {};
    if (!config || typeof config !== 'object')
        return info;
    try {
        const configurable = config.configurable;
        if (configurable && typeof configurable === 'object') {
            if (configurable.thread_id != null)
                info.threadId = String(configurable.thread_id);
            if (configurable.checkpoint_id != null)
                info.checkpointId = String(configurable.checkpoint_id);
        }
    }
    catch { /* ignore */ }
    return info;
}
function isToolNode(nodeName, action) {
    const typeName = action?.constructor?.name || '';
    if (typeName.includes('ToolNode'))
        return true;
    if (action?.func && (action.func.constructor?.name || '').includes('ToolNode'))
        return true;
    const lower = nodeName.toLowerCase();
    if (lower.includes('tool') && !lower.includes('agent'))
        return true;
    return false;
}
function setCommonSpanAttributes(span, operationType) {
    span.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, constant_1.SDK_NAME);
    span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment || 'default');
    span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName || 'default');
    span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, constant_1.SDK_VERSION);
    span.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, operationType);
    span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, semantic_convention_1.default.GEN_AI_SYSTEM_LANGGRAPH);
}
function extractGraphStructure(instance) {
    const nodes = [];
    const edges = [];
    try {
        if (instance.nodes) {
            const n = instance.nodes;
            if (typeof n.keys === 'function') {
                for (const k of n.keys())
                    nodes.push(String(k));
            }
            else if (typeof n === 'object') {
                for (const k of Object.keys(n))
                    nodes.push(k);
            }
        }
        if (instance.edges) {
            const edgeSet = instance.edges;
            if (edgeSet instanceof Set || Array.isArray(edgeSet)) {
                for (const edge of edgeSet) {
                    if (Array.isArray(edge) && edge.length >= 2) {
                        edges.push(`${edge[0]}->${edge[1]}`);
                    }
                }
            }
            else if (typeof edgeSet === 'object') {
                for (const [source, targets] of Object.entries(edgeSet)) {
                    if (typeof targets === 'object' && targets !== null) {
                        if (Array.isArray(targets)) {
                            for (const t of targets)
                                edges.push(`${source}->${t}`);
                        }
                        else if (targets instanceof Set) {
                            for (const t of targets)
                                edges.push(`${source}->${t}`);
                        }
                        else {
                            for (const t of Object.values(targets))
                                edges.push(`${source}->${t}`);
                        }
                    }
                }
            }
        }
    }
    catch { /* ignore */ }
    return { nodes, edges };
}
function setGraphAttributes(span, nodes, edges) {
    if (nodes.length > 0) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_GRAPH_NODES, JSON.stringify(nodes));
        span.setAttribute(semantic_convention_1.default.GEN_AI_GRAPH_NODE_COUNT, nodes.length);
    }
    if (edges.length > 0) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_GRAPH_EDGES, JSON.stringify(edges));
        span.setAttribute(semantic_convention_1.default.GEN_AI_GRAPH_EDGE_COUNT, edges.length);
    }
}
// ---------------------------------------------------------------------------
// Re-entry suppression via OTel context (mirrors Python _LANGGRAPH_SUPPRESS_KEY)
// ---------------------------------------------------------------------------
const LANGGRAPH_SUPPRESS_SYMBOL = Symbol.for('openlit-langgraph-suppress');
function isLangGraphSuppressed() {
    return api_1.context.active().getValue(LANGGRAPH_SUPPRESS_SYMBOL) === true;
}
function withLangGraphSuppression(fn) {
    const ctx = api_1.context.active().setValue(LANGGRAPH_SUPPRESS_SYMBOL, true);
    return api_1.context.with(ctx, fn);
}
// ---------------------------------------------------------------------------
// Wrapper factory
// ---------------------------------------------------------------------------
class LangGraphWrapper {
    /**
     * Wrap Pregel.prototype.invoke — creates an invoke_workflow span.
     */
    static _patchInvoke(tracer) {
        return (originalMethod) => {
            return function (...args) {
                if (isLangGraphSuppressed())
                    return originalMethod.apply(this, args);
                const graphName = getGraphName(this);
                const spanName = `invoke_workflow ${graphName}`;
                const links = [];
                const creationCtx = this._openlit_creation_context;
                if (creationCtx)
                    links.push({ context: creationCtx, attributes: {} });
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.INTERNAL,
                    links,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_LANGGRAPH,
                    },
                });
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    const startTime = Date.now();
                    setCommonSpanAttributes(span, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK);
                    span.setAttribute(semantic_convention_1.default.GEN_AI_WORKFLOW_NAME, graphName);
                    span.setAttribute(semantic_convention_1.default.GEN_AI_EXECUTION_MODE, 'invoke');
                    span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
                    const config = args[1] ?? (typeof args[0] === 'object' && args[0]?.configurable ? args[0] : undefined);
                    const configInfo = extractConfigInfo(config);
                    if (configInfo.threadId)
                        span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, configInfo.threadId);
                    if (configInfo.checkpointId)
                        span.setAttribute(semantic_convention_1.default.GEN_AI_CHECKPOINT_ID, configInfo.checkpointId);
                    const { nodes, edges } = extractGraphStructure(this);
                    setGraphAttributes(span, nodes, edges);
                    const execute = () => withLangGraphSuppression(() => (0, helpers_1.runWithLangGraph)(() => {
                        const convId = configInfo.threadId;
                        if (convId) {
                            return (0, helpers_1.runWithLangGraphConversationId)(convId, () => originalMethod.apply(this, args));
                        }
                        return originalMethod.apply(this, args);
                    }));
                    try {
                        const result = execute();
                        if (result && typeof result.then === 'function') {
                            return result
                                .then((response) => {
                                finalizeInvokeSpan(span, response, startTime);
                                return response;
                            })
                                .catch((e) => {
                                helpers_1.default.handleException(span, e);
                                span.end();
                                throw e;
                            });
                        }
                        finalizeInvokeSpan(span, result, startTime);
                        return result;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        span.end();
                        throw e;
                    }
                });
            };
        };
    }
    /**
     * Wrap Pregel.prototype.stream — creates an invoke_workflow span with stream mode.
     */
    static _patchStream(tracer) {
        return (originalMethod) => {
            return function (...args) {
                if (isLangGraphSuppressed())
                    return originalMethod.apply(this, args);
                const graphName = getGraphName(this);
                const spanName = `invoke_workflow ${graphName}`;
                const links = [];
                const creationCtx = this._openlit_creation_context;
                if (creationCtx)
                    links.push({ context: creationCtx, attributes: {} });
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.INTERNAL,
                    links,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_LANGGRAPH,
                    },
                });
                const parentCtx = api_1.trace.setSpan(api_1.context.active(), span);
                return api_1.context.with(parentCtx, () => {
                    const startTime = Date.now();
                    setCommonSpanAttributes(span, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK);
                    span.setAttribute(semantic_convention_1.default.GEN_AI_WORKFLOW_NAME, graphName);
                    span.setAttribute(semantic_convention_1.default.GEN_AI_EXECUTION_MODE, 'stream');
                    span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, true);
                    const config = args[1] ?? undefined;
                    const configInfo = extractConfigInfo(config);
                    if (configInfo.threadId)
                        span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, configInfo.threadId);
                    if (configInfo.checkpointId)
                        span.setAttribute(semantic_convention_1.default.GEN_AI_CHECKPOINT_ID, configInfo.checkpointId);
                    const { nodes, edges } = extractGraphStructure(this);
                    setGraphAttributes(span, nodes, edges);
                    const executionState = {
                        executedNodes: [],
                        chunkCount: 0,
                    };
                    try {
                        const result = withLangGraphSuppression(() => (0, helpers_1.runWithLangGraph)(() => {
                            const convId = configInfo.threadId;
                            if (convId) {
                                return (0, helpers_1.runWithLangGraphConversationId)(convId, () => originalMethod.apply(this, args));
                            }
                            return originalMethod.apply(this, args);
                        }));
                        if (result && typeof result[Symbol.asyncIterator] === 'function') {
                            return wrapAsyncIterableStream(result, span, executionState, startTime);
                        }
                        if (result && typeof result[Symbol.iterator] === 'function') {
                            return wrapSyncIterableStream(result, span, executionState, startTime);
                        }
                        finalizeStreamSpan(span, executionState, startTime);
                        return result;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        span.end();
                        throw e;
                    }
                });
            };
        };
    }
    /**
     * Wrap StateGraph.prototype.compile — creates a create_agent span.
     */
    static _patchCompile(tracer) {
        return (originalMethod) => {
            return function (...args) {
                if ((0, helpers_1.isCreateAgentActive)())
                    return originalMethod.apply(this, args);
                const graphName = getGraphName(this);
                const agentName = (graphName === 'graph' || graphName === 'LangGraph') ? 'default' : graphName;
                const spanName = `create_agent ${agentName}`;
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: {
                        [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
                        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_LANGGRAPH,
                    },
                });
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    const startTime = Date.now();
                    try {
                        const result = (0, helpers_1.runWithCreateAgent)(() => originalMethod.apply(this, args));
                        setCommonSpanAttributes(span, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CREATE_AGENT);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, agentName);
                        const { nodes, edges } = extractGraphStructure(this);
                        setGraphAttributes(span, nodes, edges);
                        if (nodes.length > 0) {
                            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_DESCRIPTION, `Agent with nodes: ${nodes.join(', ')}`);
                        }
                        else {
                            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_DESCRIPTION, 'LangGraph agent');
                        }
                        span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, (Date.now() - startTime) / 1000);
                        span.setStatus({ code: api_1.SpanStatusCode.OK });
                        (0, helpers_1.applyCustomSpanAttributes)(span);
                        if (result && typeof result === 'object') {
                            result._openlit_creation_context = span.spanContext();
                        }
                        span.end();
                        return result;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        span.end();
                        throw e;
                    }
                });
            };
        };
    }
    /**
     * Wrap StateGraph.prototype.addNode — wraps node callables
     * to create invoke_agent spans per node execution.
     */
    static _patchAddNode(tracer) {
        return (originalMethod) => {
            return function (...args) {
                const nodeKey = args[0];
                const action = args[1];
                if (!action || typeof action !== 'function') {
                    return originalMethod.apply(this, args);
                }
                const nodeName = typeof nodeKey === 'string' ? nodeKey : String(nodeKey);
                if (isToolNode(nodeName, action)) {
                    return originalMethod.apply(this, args);
                }
                const wrappedAction = createWrappedNode(tracer, action, nodeName);
                const newArgs = [args[0], wrappedAction, ...args.slice(2)];
                return originalMethod.apply(this, newArgs);
            };
        };
    }
}
exports.default = LangGraphWrapper;
// ---------------------------------------------------------------------------
// Node wrapper — creates invoke_agent spans for each node execution
// ---------------------------------------------------------------------------
function createWrappedNode(tracer, originalFunc, nodeName) {
    if (originalFunc._openlit_wrapped)
        return originalFunc;
    const wrapped = function (state, ...nodeArgs) {
        const spanName = `invoke_agent ${nodeName}`;
        const span = tracer.startSpan(spanName, {
            kind: api_1.SpanKind.INTERNAL,
            attributes: {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT,
                [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_LANGGRAPH,
            },
        });
        return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
            const startTime = Date.now();
            setCommonSpanAttributes(span, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT);
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_NAME, nodeName);
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_ID, nodeName);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
            const convId = (0, helpers_1.getLangGraphConversationId)();
            if (convId)
                span.setAttribute(semantic_convention_1.default.GEN_AI_CONVERSATION_ID, convId);
            (0, helpers_1.applyCustomSpanAttributes)(span);
            try {
                const result = originalFunc.call(this, state, ...nodeArgs);
                if (result && typeof result.then === 'function') {
                    return result
                        .then((res) => {
                        extractLlmInfoFromResult(span, state, res);
                        span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, (Date.now() - startTime) / 1000);
                        span.setStatus({ code: api_1.SpanStatusCode.OK });
                        span.end();
                        return res;
                    })
                        .catch((e) => {
                        helpers_1.default.handleException(span, e);
                        span.end();
                        throw e;
                    });
                }
                extractLlmInfoFromResult(span, state, result);
                span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, (Date.now() - startTime) / 1000);
                span.setStatus({ code: api_1.SpanStatusCode.OK });
                span.end();
                return result;
            }
            catch (e) {
                helpers_1.default.handleException(span, e);
                span.end();
                throw e;
            }
        });
    };
    wrapped._openlit_wrapped = true;
    Object.defineProperty(wrapped, 'name', { value: originalFunc.name || nodeName });
    return wrapped;
}
// ---------------------------------------------------------------------------
// Response processing helpers
// ---------------------------------------------------------------------------
function finalizeInvokeSpan(span, response, startTime) {
    try {
        if (response && typeof response === 'object' && response.messages) {
            const messages = response.messages;
            if (Array.isArray(messages)) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_GRAPH_MESSAGE_COUNT, messages.length);
            }
        }
    }
    catch { /* ignore */ }
    span.setAttribute(semantic_convention_1.default.GEN_AI_GRAPH_STATUS, 'success');
    span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, (Date.now() - startTime) / 1000);
    span.setStatus({ code: api_1.SpanStatusCode.OK });
    (0, helpers_1.applyCustomSpanAttributes)(span);
    span.end();
}
function finalizeStreamSpan(span, executionState, startTime) {
    span.setAttribute(semantic_convention_1.default.GEN_AI_GRAPH_EXECUTED_NODES, JSON.stringify(executionState.executedNodes));
    span.setAttribute(semantic_convention_1.default.GEN_AI_GRAPH_TOTAL_CHUNKS, executionState.chunkCount);
    span.setAttribute(semantic_convention_1.default.GEN_AI_GRAPH_STATUS, 'success');
    span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, (Date.now() - startTime) / 1000);
    span.setStatus({ code: api_1.SpanStatusCode.OK });
    (0, helpers_1.applyCustomSpanAttributes)(span);
    span.end();
}
function processStreamChunk(chunk, executionState) {
    executionState.chunkCount++;
    try {
        if (chunk && typeof chunk === 'object' && !Array.isArray(chunk)) {
            for (const key of Object.keys(chunk)) {
                if (!['__start__', '__end__', '__interrupt__'].includes(key)) {
                    if (!executionState.executedNodes.includes(key)) {
                        executionState.executedNodes.push(key);
                    }
                }
            }
        }
        if (Array.isArray(chunk) && chunk.length >= 2 && typeof chunk[0] === 'string') {
            const nodeName = chunk[0];
            if (!['__start__', '__end__', '__interrupt__'].includes(nodeName)) {
                if (!executionState.executedNodes.includes(nodeName)) {
                    executionState.executedNodes.push(nodeName);
                }
            }
        }
    }
    catch { /* ignore */ }
}
function wrapAsyncIterableStream(stream, span, executionState, startTime) {
    const originalIterator = stream[Symbol.asyncIterator].bind(stream);
    return {
        [Symbol.asyncIterator]() {
            const iter = originalIterator();
            return {
                async next() {
                    try {
                        const result = await iter.next();
                        if (result.done) {
                            finalizeStreamSpan(span, executionState, startTime);
                            return result;
                        }
                        processStreamChunk(result.value, executionState);
                        return result;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        span.end();
                        throw e;
                    }
                },
                async return(value) {
                    finalizeStreamSpan(span, executionState, startTime);
                    return iter.return ? iter.return(value) : { done: true, value };
                },
                async throw(e) {
                    helpers_1.default.handleException(span, e);
                    span.end();
                    return iter.throw ? iter.throw(e) : { done: true, value: undefined };
                },
            };
        },
    };
}
function wrapSyncIterableStream(stream, span, executionState, startTime) {
    const originalIterator = stream[Symbol.iterator].bind(stream);
    return {
        [Symbol.iterator]() {
            const iter = originalIterator();
            return {
                next() {
                    try {
                        const result = iter.next();
                        if (result.done) {
                            finalizeStreamSpan(span, executionState, startTime);
                            return result;
                        }
                        processStreamChunk(result.value, executionState);
                        return result;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        span.end();
                        throw e;
                    }
                },
                return(value) {
                    finalizeStreamSpan(span, executionState, startTime);
                    return iter.return ? iter.return(value) : { done: true, value };
                },
                throw(e) {
                    helpers_1.default.handleException(span, e);
                    span.end();
                    return iter.throw ? iter.throw(e) : { done: true, value: undefined };
                },
            };
        },
    };
}
// ---------------------------------------------------------------------------
// LLM info extraction from node results (matching Python extract_llm_info_from_result)
// ---------------------------------------------------------------------------
function extractLlmInfoFromResult(span, _state, result) {
    try {
        if (!result || typeof result !== 'object')
            return;
        const messages = result.messages;
        if (!messages || !Array.isArray(messages) || messages.length === 0)
            return;
        const lastMsg = messages[messages.length - 1];
        if (!lastMsg)
            return;
        if (lastMsg.response_metadata && typeof lastMsg.response_metadata === 'object') {
            const metadata = lastMsg.response_metadata;
            const modelName = metadata.model_name || metadata.model;
            if (modelName) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, modelName);
                span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, modelName);
            }
            const tokenUsage = metadata.token_usage;
            if (tokenUsage && typeof tokenUsage === 'object') {
                if (tokenUsage.prompt_tokens != null) {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, tokenUsage.prompt_tokens);
                }
                if (tokenUsage.completion_tokens != null) {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, tokenUsage.completion_tokens);
                }
            }
            if (metadata.finish_reason) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, [metadata.finish_reason]);
            }
            if (metadata.id) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_ID, metadata.id);
            }
        }
        if (lastMsg.usage_metadata && typeof lastMsg.usage_metadata === 'object') {
            const usage = lastMsg.usage_metadata;
            if (usage.input_tokens != null) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, usage.input_tokens);
            }
            if (usage.output_tokens != null) {
                span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, usage.output_tokens);
            }
        }
        if (lastMsg.content != null) {
            const content = typeof lastMsg.content === 'string'
                ? lastMsg.content
                : JSON.stringify(lastMsg.content);
            if (content && config_1.default.captureMessageContent) {
                const rawRole = lastMsg.role || lastMsg._getType?.() || lastMsg.type || '';
                const role = (0, helpers_1.mapLangChainRole)(rawRole);
                if (role === helpers_1.OTEL_ASSISTANT_ROLE) {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, JSON.stringify([{ role, parts: [{ type: 'text', content }] }]));
                }
            }
        }
    }
    catch { /* don't fail the span */ }
}
//# sourceMappingURL=wrapper.js.map