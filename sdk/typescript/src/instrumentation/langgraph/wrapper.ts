import {
  Tracer,
  SpanKind,
  context,
  trace,
  SpanContext,
  Link,
  SpanStatusCode,
} from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import OpenLitHelper, { applyCustomSpanAttributes } from '../../helpers';
import {
  runWithLangGraph,
  runWithCreateAgent,
  isCreateAgentActive,
  getLangGraphConversationId,
  runWithLangGraphConversationId,
} from '../../helpers';
import { SDK_NAME, SDK_VERSION } from '../../constant';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGraphName(instance: any): string {
  if (!instance) return 'graph';
  const name = instance.name;
  if (name) return String(name);
  const graphId = instance.graph_id ?? instance.graphId;
  if (graphId) return String(graphId);
  const className = instance.constructor?.name;
  if (className && !['Pregel', 'CompiledStateGraph', 'StateGraph'].includes(className)) {
    return className;
  }
  return 'graph';
}

function extractConfigInfo(config: any): { threadId?: string; checkpointId?: string } {
  const info: { threadId?: string; checkpointId?: string } = {};
  if (!config || typeof config !== 'object') return info;
  try {
    const configurable = config.configurable;
    if (configurable && typeof configurable === 'object') {
      if (configurable.thread_id != null) info.threadId = String(configurable.thread_id);
      if (configurable.checkpoint_id != null) info.checkpointId = String(configurable.checkpoint_id);
    }
  } catch { /* ignore */ }
  return info;
}

function isToolNode(nodeName: string, action: any): boolean {
  const typeName = action?.constructor?.name || '';
  if (typeName.includes('ToolNode')) return true;
  if (action?.func && (action.func.constructor?.name || '').includes('ToolNode')) return true;
  const lower = nodeName.toLowerCase();
  if (lower.includes('tool') && !lower.includes('agent')) return true;
  return false;
}

function setCommonSpanAttributes(
  span: any,
  operationType: string,
): void {
  span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
  span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment || 'default');
  span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName || 'default');
  span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
  span.setAttribute(SemanticConvention.GEN_AI_OPERATION, operationType);
  span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, SemanticConvention.GEN_AI_SYSTEM_LANGGRAPH);
}

function extractGraphStructure(instance: any): { nodes: string[]; edges: string[] } {
  const nodes: string[] = [];
  const edges: string[] = [];
  try {
    if (instance.nodes) {
      const n = instance.nodes;
      if (typeof n.keys === 'function') {
        for (const k of n.keys()) nodes.push(String(k));
      } else if (typeof n === 'object') {
        for (const k of Object.keys(n)) nodes.push(k);
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
      } else if (typeof edgeSet === 'object') {
        for (const [source, targets] of Object.entries(edgeSet as Record<string, any>)) {
          if (typeof targets === 'object' && targets !== null) {
            if (Array.isArray(targets)) {
              for (const t of targets) edges.push(`${source}->${t}`);
            } else if (targets instanceof Set) {
              for (const t of targets) edges.push(`${source}->${t}`);
            } else {
              for (const t of Object.values(targets)) edges.push(`${source}->${t}`);
            }
          }
        }
      }
    }
  } catch { /* ignore */ }
  return { nodes, edges };
}

function setGraphAttributes(span: any, nodes: string[], edges: string[]): void {
  if (nodes.length > 0) {
    span.setAttribute(SemanticConvention.GEN_AI_GRAPH_NODES, JSON.stringify(nodes));
    span.setAttribute(SemanticConvention.GEN_AI_GRAPH_NODE_COUNT, nodes.length);
  }
  if (edges.length > 0) {
    span.setAttribute(SemanticConvention.GEN_AI_GRAPH_EDGES, JSON.stringify(edges));
    span.setAttribute(SemanticConvention.GEN_AI_GRAPH_EDGE_COUNT, edges.length);
  }
}

// ---------------------------------------------------------------------------
// Re-entry suppression via OTel context (mirrors Python _LANGGRAPH_SUPPRESS_KEY)
// ---------------------------------------------------------------------------

const LANGGRAPH_SUPPRESS_SYMBOL = Symbol.for('openlit-langgraph-suppress');

function isLangGraphSuppressed(): boolean {
  return context.active().getValue(LANGGRAPH_SUPPRESS_SYMBOL) === true;
}

function withLangGraphSuppression<T>(fn: () => T): T {
  const ctx = context.active().setValue(LANGGRAPH_SUPPRESS_SYMBOL, true);
  return context.with(ctx, fn);
}

// ---------------------------------------------------------------------------
// Wrapper factory
// ---------------------------------------------------------------------------

export default class LangGraphWrapper {
  /**
   * Wrap Pregel.prototype.invoke — creates an invoke_workflow span.
   */
  static _patchInvoke(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        if (isLangGraphSuppressed()) return originalMethod.apply(this, args);

        const graphName = getGraphName(this);
        const spanName = `invoke_workflow ${graphName}`;
        const links: Link[] = [];
        const creationCtx: SpanContext | undefined = this._openlit_creation_context;
        if (creationCtx) links.push({ context: creationCtx, attributes: {} });

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.INTERNAL,
          links,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_LANGGRAPH,
          },
        });

        return context.with(trace.setSpan(context.active(), span), () => {
          const startTime = Date.now();
          setCommonSpanAttributes(span, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK);
          span.setAttribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, graphName);
          span.setAttribute(SemanticConvention.GEN_AI_EXECUTION_MODE, 'invoke');
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

          const config = args[1] ?? (typeof args[0] === 'object' && args[0]?.configurable ? args[0] : undefined);
          const configInfo = extractConfigInfo(config);
          if (configInfo.threadId) span.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, configInfo.threadId);
          if (configInfo.checkpointId) span.setAttribute(SemanticConvention.GEN_AI_CHECKPOINT_ID, configInfo.checkpointId);

          const { nodes, edges } = extractGraphStructure(this);
          setGraphAttributes(span, nodes, edges);

          const execute = () => withLangGraphSuppression(() =>
            runWithLangGraph(() => {
              const convId = configInfo.threadId;
              if (convId) {
                return runWithLangGraphConversationId(convId, () => originalMethod.apply(this, args));
              }
              return originalMethod.apply(this, args);
            })
          );

          try {
            const result = execute();
            if (result && typeof result.then === 'function') {
              return result
                .then((response: any) => {
                  finalizeInvokeSpan(span, response, startTime);
                  return response;
                })
                .catch((e: any) => {
                  OpenLitHelper.handleException(span, e);
                  span.end();
                  throw e;
                });
            }
            finalizeInvokeSpan(span, result, startTime);
            return result;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
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
  static _patchStream(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        if (isLangGraphSuppressed()) return originalMethod.apply(this, args);

        const graphName = getGraphName(this);
        const spanName = `invoke_workflow ${graphName}`;
        const links: Link[] = [];
        const creationCtx: SpanContext | undefined = this._openlit_creation_context;
        if (creationCtx) links.push({ context: creationCtx, attributes: {} });

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.INTERNAL,
          links,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_LANGGRAPH,
          },
        });

        const parentCtx = trace.setSpan(context.active(), span);

        return context.with(parentCtx, () => {
          const startTime = Date.now();
          setCommonSpanAttributes(span, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK);
          span.setAttribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, graphName);
          span.setAttribute(SemanticConvention.GEN_AI_EXECUTION_MODE, 'stream');
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);

          const config = args[1] ?? undefined;
          const configInfo = extractConfigInfo(config);
          if (configInfo.threadId) span.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, configInfo.threadId);
          if (configInfo.checkpointId) span.setAttribute(SemanticConvention.GEN_AI_CHECKPOINT_ID, configInfo.checkpointId);

          const { nodes, edges } = extractGraphStructure(this);
          setGraphAttributes(span, nodes, edges);

          const executionState = {
            executedNodes: [] as string[],
            chunkCount: 0,
          };

          try {
            const result = withLangGraphSuppression(() =>
              runWithLangGraph(() => {
                const convId = configInfo.threadId;
                if (convId) {
                  return runWithLangGraphConversationId(convId, () => originalMethod.apply(this, args));
                }
                return originalMethod.apply(this, args);
              })
            );

            if (result && typeof result[Symbol.asyncIterator] === 'function') {
              return wrapAsyncIterableStream(result, span, executionState, startTime);
            }
            if (result && typeof result[Symbol.iterator] === 'function') {
              return wrapSyncIterableStream(result, span, executionState, startTime);
            }

            finalizeStreamSpan(span, executionState, startTime);
            return result;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
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
  static _patchCompile(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        if (isCreateAgentActive()) return originalMethod.apply(this, args);

        const graphName = getGraphName(this);
        const agentName = (graphName === 'graph' || graphName === 'LangGraph') ? 'default' : graphName;
        const spanName = `create_agent ${agentName}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_LANGGRAPH,
          },
        });

        return context.with(trace.setSpan(context.active(), span), () => {
          const startTime = Date.now();
          try {
            const result = runWithCreateAgent(() => originalMethod.apply(this, args));

            setCommonSpanAttributes(span, SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT);
            span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, agentName);

            const { nodes, edges } = extractGraphStructure(this);
            setGraphAttributes(span, nodes, edges);

            if (nodes.length > 0) {
              span.setAttribute(SemanticConvention.GEN_AI_TOOL_DEFINITIONS, JSON.stringify(nodes));
              span.setAttribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, `Agent with nodes: ${nodes.join(', ')}`);
            } else {
              span.setAttribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, 'LangGraph agent');
            }

            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, (Date.now() - startTime) / 1000);
            span.setStatus({ code: SpanStatusCode.OK });
            applyCustomSpanAttributes(span);

            if (result && typeof result === 'object') {
              result._openlit_creation_context = span.spanContext();
            }

            span.end();
            return result;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
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
  static _patchAddNode(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
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

// ---------------------------------------------------------------------------
// Node wrapper — creates invoke_agent spans for each node execution
// ---------------------------------------------------------------------------

function createWrappedNode(tracer: Tracer, originalFunc: any, nodeName: string): any {
  if (originalFunc._openlit_wrapped) return originalFunc;

  const wrapped = function (this: any, state: any, ...nodeArgs: any[]) {
    const spanName = `invoke_agent ${nodeName}`;
    const span = tracer.startSpan(spanName, {
      kind: SpanKind.INTERNAL,
      attributes: {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_LANGGRAPH,
      },
    });

    return context.with(trace.setSpan(context.active(), span), () => {
      const startTime = Date.now();
      setCommonSpanAttributes(span, SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT);
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, nodeName);
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_ID, nodeName);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);

      const convId = getLangGraphConversationId();
      if (convId) span.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, convId);
      applyCustomSpanAttributes(span);

      try {
        const result = originalFunc.call(this, state, ...nodeArgs);
        if (result && typeof result.then === 'function') {
          return result
            .then((res: any) => {
              extractLlmInfoFromResult(span, state, res);
              span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, (Date.now() - startTime) / 1000);
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              return res;
            })
            .catch((e: any) => {
              OpenLitHelper.handleException(span, e);
              span.end();
              throw e;
            });
        }
        extractLlmInfoFromResult(span, state, result);
        span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, (Date.now() - startTime) / 1000);
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (e: any) {
        OpenLitHelper.handleException(span, e);
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

function finalizeInvokeSpan(span: any, response: any, startTime: number): void {
  try {
    if (response && typeof response === 'object' && response.messages) {
      const messages = response.messages;
      if (Array.isArray(messages)) {
        span.setAttribute(SemanticConvention.GEN_AI_GRAPH_MESSAGE_COUNT, messages.length);
      }
    }
  } catch { /* ignore */ }

  span.setAttribute(SemanticConvention.GEN_AI_GRAPH_STATUS, 'success');
  span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, (Date.now() - startTime) / 1000);
  span.setStatus({ code: SpanStatusCode.OK });
  applyCustomSpanAttributes(span);
  span.end();
}

function finalizeStreamSpan(
  span: any,
  executionState: { executedNodes: string[]; chunkCount: number },
  startTime: number
): void {
  span.setAttribute(SemanticConvention.GEN_AI_GRAPH_EXECUTED_NODES, JSON.stringify(executionState.executedNodes));
  span.setAttribute(SemanticConvention.GEN_AI_GRAPH_TOTAL_CHUNKS, executionState.chunkCount);
  span.setAttribute(SemanticConvention.GEN_AI_GRAPH_STATUS, 'success');
  span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, (Date.now() - startTime) / 1000);
  span.setStatus({ code: SpanStatusCode.OK });
  applyCustomSpanAttributes(span);
  span.end();
}

function processStreamChunk(
  chunk: any,
  executionState: { executedNodes: string[]; chunkCount: number }
): void {
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
  } catch { /* ignore */ }
}

function wrapAsyncIterableStream(
  stream: AsyncIterable<any>,
  span: any,
  executionState: { executedNodes: string[]; chunkCount: number },
  startTime: number
): AsyncIterable<any> {
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
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            span.end();
            throw e;
          }
        },
        async return(value?: any) {
          finalizeStreamSpan(span, executionState, startTime);
          return iter.return ? iter.return(value) : { done: true as const, value };
        },
        async throw(e?: any) {
          OpenLitHelper.handleException(span, e);
          span.end();
          return iter.throw ? iter.throw(e) : { done: true as const, value: undefined };
        },
      };
    },
  } as AsyncIterable<any>;
}

function wrapSyncIterableStream(
  stream: Iterable<any>,
  span: any,
  executionState: { executedNodes: string[]; chunkCount: number },
  startTime: number
): Iterable<any> {
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
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            span.end();
            throw e;
          }
        },
        return(value?: any) {
          finalizeStreamSpan(span, executionState, startTime);
          return iter.return ? iter.return(value) : { done: true as const, value };
        },
        throw(e?: any) {
          OpenLitHelper.handleException(span, e);
          span.end();
          return iter.throw ? iter.throw(e) : { done: true as const, value: undefined };
        },
      };
    },
  } as Iterable<any>;
}

// ---------------------------------------------------------------------------
// LLM info extraction from node results (matching Python extract_llm_info_from_result)
// ---------------------------------------------------------------------------

function extractLlmInfoFromResult(span: any, _state: any, result: any): void {
  try {
    if (!result || typeof result !== 'object') return;
    const messages = result.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return;

    if (lastMsg.response_metadata && typeof lastMsg.response_metadata === 'object') {
      const metadata = lastMsg.response_metadata;
      const modelName = metadata.model_name || metadata.model;
      if (modelName) {
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, modelName);
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, modelName);
      }
      const tokenUsage = metadata.token_usage;
      if (tokenUsage && typeof tokenUsage === 'object') {
        if (tokenUsage.prompt_tokens != null) {
          span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, tokenUsage.prompt_tokens);
        }
        if (tokenUsage.completion_tokens != null) {
          span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, tokenUsage.completion_tokens);
        }
      }
      if (metadata.finish_reason) {
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [metadata.finish_reason]);
      }
      if (metadata.id) {
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, metadata.id);
      }
    }

    if (lastMsg.usage_metadata && typeof lastMsg.usage_metadata === 'object') {
      const usage = lastMsg.usage_metadata;
      if (usage.input_tokens != null) {
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, usage.input_tokens);
      }
      if (usage.output_tokens != null) {
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, usage.output_tokens);
      }
    }

    if (lastMsg.content != null) {
      const content = typeof lastMsg.content === 'string'
        ? lastMsg.content
        : JSON.stringify(lastMsg.content);
      if (content && OpenlitConfig.captureMessageContent) {
        const role = lastMsg.role || lastMsg._getType?.() || lastMsg.type || 'assistant';
        span.setAttribute(
          SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
          JSON.stringify([{ role, parts: [{ type: 'text', content }] }])
        );
      }
    }
  } catch { /* don't fail the span */ }
}
