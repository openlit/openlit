/**
 * Cursor SDK wrapper -- OTel GenAI semantic convention compliant.
 *
 * Wraps Agent.create(), Agent.resume(), and agent.send()
 * to produce `create_agent`, `invoke_agent`, and `execute_tool` spans.
 *
 * Agent.prompt() is NOT wrapped separately -- it internally calls
 * create() + send(), so the patched versions handle it automatically
 * without producing duplicate spans.
 *
 * Token usage is captured via onDelta injection (TurnEndedUpdate).
 * Tool call spans are created from SDKMessage stream events.
 * The `system` stream event provides resolved model and tool definitions.
 */

import {
  Tracer,
  Span,
  SpanKind,
  SpanStatusCode,
  SpanContext,
  context as otelContext,
  trace,
  Link,
} from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  applyCustomSpanAttributes,
  getServerAddressForProvider,
  setFrameworkLlmActive,
  resetFrameworkLlmActive,
  getCurrentAgentVersion,
} from '../../helpers';
import { SDK_NAME, SDK_VERSION } from '../../constant';
import Metrics from '../../otel/metrics';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const [SERVER_ADDRESS, SERVER_PORT] = getServerAddressForProvider('cursor');

const CURSOR_STATUS_TO_FINISH_REASON: Record<string, string> = {
  finished: 'stop',
  error: 'error',
  cancelled: 'cancelled',
};

// ---------------------------------------------------------------------------
// Agent creation registry -- links invoke_agent back to create_agent
// ---------------------------------------------------------------------------

interface AgentCreationInfo {
  spanContext: SpanContext;
  /** Raw `options` passed to `Agent.create()` — used to surface system_instructions and tool definitions on invoke_agent spans. */
  options?: any;
}

class AgentCreationRegistry {
  private _entries = new WeakMap<object, AgentCreationInfo>();

  register(agent: object, spanContext: SpanContext, options?: any): void {
    this._entries.set(agent, { spanContext, options });
  }

  get(agent: object): AgentCreationInfo | undefined {
    return this._entries.get(agent);
  }
}

const agentRegistry = new AgentCreationRegistry();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateContent(content: string): string {
  const maxLen = OpenlitConfig.maxContentLength;
  if (maxLen != null && maxLen > 0 && content.length > maxLen) {
    return content.slice(0, maxLen);
  }
  return content;
}

function mapRunStatusToFinishReason(status: string | undefined): string {
  if (!status) return 'stop';
  return CURSOR_STATUS_TO_FINISH_REASON[status] || status;
}

function resolveAgentName(options: any): string | null {
  if (!options) return null;
  const name = options.name;
  if (name && typeof name === 'string' && name.trim()) return name.trim();
  return null;
}

function resolveModelId(options: any): string | null {
  if (!options?.model) return null;
  const model = options.model;
  if (typeof model === 'string') return model;
  if (typeof model === 'object' && model.id) return String(model.id);
  return null;
}

/**
 * Stamp `openlit.agent.version_hash` (auto) and `gen_ai.agent.version`
 * (user override, if set) on the span and return the same attributes so
 * the caller can merge them into the inference event extras.
 */
function stampAgentVersion(
  span: Span,
  args: {
    systemInstructionsJson?: string;
    toolDefinitionsJson?: string;
    primaryModel?: string;
    temperature?: number | null;
    top_p?: number | null;
    max_tokens?: number | null;
  }
): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const versionHash = OpenLitHelper.computeAgentVersionHash({
      systemInstructions: args.systemInstructionsJson ?? null,
      toolDefinitions: args.toolDefinitionsJson ?? null,
      primaryModel: args.primaryModel ?? null,
      runtimeConfig: {
        temperature: args.temperature ?? null,
        top_p: args.top_p ?? null,
        max_tokens: args.max_tokens ?? null,
        provider: SemanticConvention.GEN_AI_SYSTEM_CURSOR,
      },
      providers: [SemanticConvention.GEN_AI_SYSTEM_CURSOR],
    });
    if (versionHash) {
      out[SemanticConvention.OPENLIT_AGENT_VERSION_HASH] = versionHash;
      span.setAttribute(
        SemanticConvention.OPENLIT_AGENT_VERSION_HASH,
        versionHash
      );
    }
  } catch {
    // Hash computation must never fail the wrapped call.
  }
  const versionLabel = getCurrentAgentVersion();
  if (versionLabel) {
    out[SemanticConvention.GEN_AI_AGENT_VERSION] = versionLabel;
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_VERSION, versionLabel);
  }
  return out;
}

function setCommonSpanAttributes(span: Span): void {
  span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
  span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment ?? 'default');
  span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName ?? 'default');
  span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
  span.setAttribute(SemanticConvention.SERVER_ADDRESS, SERVER_ADDRESS);
  span.setAttribute(SemanticConvention.SERVER_PORT, SERVER_PORT);
}

// ---------------------------------------------------------------------------
// Tool span tracker -- manages in-flight execute_tool spans from stream
// ---------------------------------------------------------------------------

class ToolSpanTracker {
  private _tracer: Tracer;
  private _parentSpan: Span;
  private _captureContent: boolean;
  private _inFlight = new Map<string, Span>();

  constructor(tracer: Tracer, parentSpan: Span, captureContent: boolean) {
    this._tracer = tracer;
    this._parentSpan = parentSpan;
    this._captureContent = captureContent;
  }

  startTool(toolName: string, callId: string, args?: unknown): void {
    const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS} ${toolName}`;
    const parentCtx = trace.setSpan(otelContext.active(), this._parentSpan);

    const span = this._tracer.startSpan(spanName, {
      kind: SpanKind.INTERNAL,
      attributes: {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_CURSOR,
      },
    }, parentCtx);

    span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, toolName);
    span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, callId);
    span.setAttribute(SemanticConvention.GEN_AI_TOOL_TYPE_OTEL, 'extension');

    setCommonSpanAttributes(span);

    if (this._captureContent && args != null) {
      try {
        const argsStr = typeof args === 'string' ? args : JSON.stringify(args);
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, truncateContent(argsStr));
      } catch { /* ignore */ }
    }

    applyCustomSpanAttributes(span);
    this._inFlight.set(callId, span);
  }

  endTool(callId: string, result?: unknown, isError = false): void {
    const span = this._inFlight.get(callId);
    if (!span) return;
    this._inFlight.delete(callId);

    if (isError) {
      span.setAttribute(SemanticConvention.ERROR_TYPE, 'ToolExecutionError');
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'tool execution failed' });
    } else {
      if (this._captureContent && result != null) {
        try {
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_RESULT, truncateContent(resultStr));
        } catch { /* ignore */ }
      }
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
  }

  endAll(): void {
    for (const [, span] of this._inFlight) {
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    }
    this._inFlight.clear();
  }
}

// ---------------------------------------------------------------------------
// Process SDKMessage stream events for tool spans and content capture
// ---------------------------------------------------------------------------

interface StreamState {
  assistantText: string;
  thinkingText: string;
  toolCalls: Array<{ name: string; callId: string; args?: unknown; result?: unknown }>;
  resolvedModel: string | null;
  /** Raw tool definitions surfaced via the `system` stream event (or via Agent.create options). */
  toolDefinitions: any[] | null;
  /** System instructions surfaced via the `system` stream event (or via Agent.create options). */
  systemInstructions: string | null;
  runId: string | null;
  firstContentTimeMs: number | null;
}

function processStreamEvent(
  event: any,
  toolTracker: ToolSpanTracker,
  state: StreamState,
): void {
  if (!event || !event.type) return;

  if (!state.runId && event.run_id) {
    state.runId = event.run_id;
  }

  switch (event.type) {
    case 'system': {
      if (event.model) {
        const modelId = typeof event.model === 'string' ? event.model : event.model?.id;
        if (modelId) state.resolvedModel = String(modelId);
      }
      if (Array.isArray(event.tools) && event.tools.length > 0) {
        // Preserve full tool schemas (name/description/parameters) when the
        // SDK provides them; fall back to name-only entries for older
        // versions that emit strings.
        state.toolDefinitions = event.tools.map((tool: any) =>
          typeof tool === 'string' ? { name: tool } : tool,
        );
      }
      if (typeof event.instructions === 'string' && event.instructions) {
        state.systemInstructions = event.instructions;
      } else if (typeof event.systemPrompt === 'string' && event.systemPrompt) {
        state.systemInstructions = event.systemPrompt;
      }
      break;
    }
    case 'tool_call': {
      const callId = event.call_id;
      const toolName = event.name || 'unknown';
      const status = event.status;

      if (status === 'running') {
        toolTracker.startTool(toolName, callId, event.args);
        state.toolCalls.push({ name: toolName, callId, args: event.args });
      } else if (status === 'completed') {
        toolTracker.endTool(callId, event.result, false);
        const tc = state.toolCalls.find(t => t.callId === callId);
        if (tc) tc.result = event.result;
      } else if (status === 'error') {
        toolTracker.endTool(callId, event.result, true);
      }
      break;
    }
    case 'assistant': {
      if (state.firstContentTimeMs === null) {
        state.firstContentTimeMs = Date.now();
      }
      const content = event.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            state.assistantText += block.text;
          }
        }
      }
      break;
    }
    case 'thinking': {
      if (state.firstContentTimeMs === null) {
        state.firstContentTimeMs = Date.now();
      }
      if (event.text) {
        state.thinkingText += event.text;
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Build OTel input/output messages
// ---------------------------------------------------------------------------

function buildInputMessages(message: string | any): string | null {
  try {
    if (typeof message === 'string') {
      return JSON.stringify([{
        role: 'user',
        parts: [{ type: 'text', content: truncateContent(message) }],
      }]);
    }

    const parts: any[] = [];
    if (message?.text) {
      parts.push({ type: 'text', content: truncateContent(message.text) });
    }
    if (Array.isArray(message?.images)) {
      for (const img of message.images) {
        parts.push({ type: 'image', mimeType: img.mimeType || 'image/png' });
      }
    }
    if (parts.length === 0) return null;
    return JSON.stringify([{ role: 'user', parts }]);
  } catch { return null; }
}

function buildOutputMessages(state: StreamState, finishReason: string): string | null {
  try {
    const parts: any[] = [];

    if (state.assistantText) {
      parts.push({ type: 'text', content: truncateContent(state.assistantText) });
    }

    if (state.thinkingText) {
      parts.push({ type: 'reasoning', content: truncateContent(state.thinkingText) });
    }

    for (const tc of state.toolCalls) {
      const toolPart: any = {
        type: 'tool_call',
        id: tc.callId,
        name: tc.name,
      };
      if (tc.args != null) {
        toolPart.arguments = typeof tc.args === 'object' ? tc.args : {};
      }
      parts.push(toolPart);
    }

    if (parts.length === 0) return null;
    return JSON.stringify([{ role: 'assistant', parts, finish_reason: finishReason }]);
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Emit inference event for invoke_agent spans
// ---------------------------------------------------------------------------

function emitInvokeAgentEvent(
  span: Span,
  agentId: string | null,
  model: string | null,
  responseModel: string | null,
  finishReason: string,
  inputTokens: number,
  outputTokens: number,
  inputMessagesJson: string | null,
  outputMessagesJson: string | null,
  systemInstructionsJson: string | null,
  toolDefinitionsJson: string | null,
  versionExtras?: Record<string, string>,
): void {
  if (OpenlitConfig.disableEvents) return;

  try {
    const attributes: Record<string, any> = {
      [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
      [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_CURSOR,
      [SemanticConvention.SERVER_ADDRESS]: SERVER_ADDRESS,
      [SemanticConvention.SERVER_PORT]: SERVER_PORT,
    };

    if (model) attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = model;
    if (responseModel) attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] = responseModel;
    if (agentId) attributes[SemanticConvention.GEN_AI_CONVERSATION_ID] = agentId;
    if (finishReason) attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = [finishReason];
    if (inputTokens) attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = inputTokens;
    if (outputTokens) attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = outputTokens;

    if (inputMessagesJson != null) {
      attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
    }
    if (outputMessagesJson != null) {
      attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
    }
    if (systemInstructionsJson != null) {
      attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = systemInstructionsJson;
    }
    if (toolDefinitionsJson != null) {
      attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = toolDefinitionsJson;
    }
    if (versionExtras) {
      Object.assign(attributes, versionExtras);
    }

    OpenLitHelper.emitInferenceEvent(span, attributes);
  } catch { /* swallow */ }
}

// ---------------------------------------------------------------------------
// Record metrics for invoke_agent spans
// ---------------------------------------------------------------------------

function recordInvokeAgentMetrics(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cost: number,
  duration: number,
  errorType?: string,
): void {
  if (OpenlitConfig.disableMetrics) return;

  try {
    const attributes: Record<string, any> = {
      [ATTR_TELEMETRY_SDK_NAME]: SDK_NAME,
      [ATTR_SERVICE_NAME]: OpenlitConfig.applicationName ?? 'default',
      [SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]: OpenlitConfig.environment ?? 'default',
      [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_CURSOR,
      [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
      [SemanticConvention.SERVER_ADDRESS]: SERVER_ADDRESS,
      [SemanticConvention.SERVER_PORT]: SERVER_PORT,
    };
    if (model) attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = model;
    if (errorType) attributes[SemanticConvention.ERROR_TYPE] = errorType;

    if (Metrics.genaiClientOperationDuration) {
      Metrics.genaiClientOperationDuration.record(duration, attributes);
    }

    if (inputTokens && Metrics.genaiClientUsageTokens) {
      Metrics.genaiClientUsageTokens.record(inputTokens, {
        ...attributes,
        [SemanticConvention.GEN_AI_TOKEN_TYPE]: SemanticConvention.GEN_AI_TOKEN_TYPE_INPUT,
      });
    }
    if (outputTokens && Metrics.genaiClientUsageTokens) {
      Metrics.genaiClientUsageTokens.record(outputTokens, {
        ...attributes,
        [SemanticConvention.GEN_AI_TOKEN_TYPE]: SemanticConvention.GEN_AI_TOKEN_TYPE_OUTPUT,
      });
    }
    if (cost && Metrics.genaiCost) {
      Metrics.genaiCost.record(cost, attributes);
    }
  } catch { /* swallow */ }
}

// ---------------------------------------------------------------------------
// wrapSend -- wraps agent.send() to produce invoke_agent spans
// ---------------------------------------------------------------------------

function wrapSend(
  tracer: Tracer,
  originalSend: any,
  agentId: string,
  agentName: string | null,
  modelId: string | null,
): any {
  return function wrappedSend(this: any, message: any, options?: any) {
    const captureContent = OpenlitConfig.captureMessageContent ?? true;
    const displayName = agentName || agentId;
    const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT} ${displayName}`;
    const requestModel = modelId || resolveModelId(options) || 'unknown';

    const creationInfo = agentRegistry.get(this);
    const creationSpanCtx = creationInfo?.spanContext;
    const links: Link[] = [];
    if (creationSpanCtx) {
      links.push({ context: creationSpanCtx });
    }

    // Start invoke_agent in the same trace as create_agent by using its
    // span context as parent. This keeps both spans in one trace while
    // the span link provides explicit correlation.
    let parentCtx = otelContext.active();
    if (creationSpanCtx) {
      const remoteSpan = trace.wrapSpanContext(creationSpanCtx);
      parentCtx = trace.setSpan(parentCtx, remoteSpan);
    }

    const span = tracer.startSpan(spanName, {
      kind: SpanKind.CLIENT,
      attributes: {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_CURSOR,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.SERVER_ADDRESS]: SERVER_ADDRESS,
        [SemanticConvention.SERVER_PORT]: SERVER_PORT,
      },
      links,
    }, parentCtx);

    setCommonSpanAttributes(span);
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_ID, agentId);
    span.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, agentId);
    if (agentName) span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, agentName);

    if (captureContent) {
      const inputJson = buildInputMessages(message);
      if (inputJson) span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputJson);
    }

    applyCustomSpanAttributes(span);

    const startTime = Date.now() / 1000;
    const startTimeMs = Date.now();
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const toolTracker = new ToolSpanTracker(tracer, span, captureContent);
    const streamState: StreamState = {
      assistantText: '',
      thinkingText: '',
      toolCalls: [],
      resolvedModel: null,
      toolDefinitions: null,
      systemInstructions: null,
      runId: null,
      firstContentTimeMs: null,
    };

    // Seed system_instructions and tool_definitions from `Agent.create` options
    // so they're available before the system stream event arrives.
    const createOptions = creationInfo?.options;
    if (createOptions) {
      const seedInstructions =
        (typeof createOptions.instructions === 'string' && createOptions.instructions) ||
        (typeof createOptions.systemPrompt === 'string' && createOptions.systemPrompt) ||
        null;
      if (seedInstructions) streamState.systemInstructions = seedInstructions;
      if (Array.isArray(createOptions.tools) && createOptions.tools.length > 0) {
        streamState.toolDefinitions = createOptions.tools.slice();
      }
    }

    const userOnDelta = options?.onDelta;
    const mergedOptions = { ...options };
    mergedOptions.onDelta = async (args: any) => {
      try {
        const update = args?.update;
        if (update?.type === 'turn-ended' && update.usage) {
          usage.inputTokens += update.usage.inputTokens || 0;
          usage.outputTokens += update.usage.outputTokens || 0;
          usage.cacheReadTokens += update.usage.cacheReadTokens || 0;
          usage.cacheWriteTokens += update.usage.cacheWriteTokens || 0;
        }
      } catch { /* swallow */ }

      if (userOnDelta) {
        return userOnDelta(args);
      }
    };

    const spanContext = trace.setSpan(otelContext.active(), span);

    setFrameworkLlmActive();
    let runPromise: Promise<any>;
    try {
      runPromise = otelContext.with(spanContext, () => {
        return originalSend.call(this, message, mergedOptions);
      });
    } catch (e: any) {
      resetFrameworkLlmActive();
      OpenLitHelper.handleException(span, e);
      span.end();
      throw e;
    }

    return runPromise.then((run: any) => {
      return createRunProxy(
        run, tracer, span, startTime, startTimeMs, usage, toolTracker,
        streamState, captureContent, agentId, agentName, requestModel, message,
      );
    }).catch((e: any) => {
      resetFrameworkLlmActive();
      OpenLitHelper.handleException(span, e);
      recordInvokeAgentMetrics(
        requestModel, 0, 0, 0,
        (Date.now() / 1000) - startTime,
        e?.constructor?.name || '_OTHER',
      );
      span.end();
      throw e;
    });
  };
}

// ---------------------------------------------------------------------------
// createRunProxy -- proxies the Run to intercept stream() and wait()
// ---------------------------------------------------------------------------

function createRunProxy(
  run: any,
  tracer: Tracer,
  span: Span,
  startTime: number,
  startTimeMs: number,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  toolTracker: ToolSpanTracker,
  streamState: StreamState,
  captureContent: boolean,
  agentId: string,
  agentName: string | null,
  requestModel: string,
  message: any,
): any {
  let finalized = false;
  let isStreamMode = false;

  const finalizeSpan = (result?: any, error?: any) => {
    if (finalized) return;
    finalized = true;

    resetFrameworkLlmActive();
    toolTracker.endAll();

    const duration = (Date.now() / 1000) - startTime;
    const status = result?.status || run.status || 'finished';
    const finishReason = mapRunStatusToFinishReason(status);
    const responseModel = streamState.resolvedModel || result?.model?.id || run.model?.id || null;
    const durationMs = result?.durationMs || run.durationMs;

    if (responseModel) span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);

    const runId = streamState.runId || run.id;
    if (runId) span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, runId);

    if (isStreamMode) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STREAM, true);
    }

    if (usage.inputTokens) span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, usage.inputTokens);
    if (usage.outputTokens) span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, usage.outputTokens);
    if (usage.cacheReadTokens) span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, usage.cacheReadTokens);
    if (usage.cacheWriteTokens) span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, usage.cacheWriteTokens);

    const effectiveDuration = durationMs ? durationMs / 1000 : duration;
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, effectiveDuration);

    if (isStreamMode && streamState.firstContentTimeMs !== null) {
      const ttft = (streamState.firstContentTimeMs - startTimeMs) / 1000;
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK, ttft);
    }

    const toolDefinitionsJson = streamState.toolDefinitions
      ? OpenLitHelper.buildToolDefinitions(streamState.toolDefinitions)
      : undefined;
    if (toolDefinitionsJson) {
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
    }

    // Compute system_instructions JSON regardless of captureContent so
    // versions still group correctly when content capture is disabled.
    const systemInstructionsJson = streamState.systemInstructions
      ? JSON.stringify([{ type: 'text', content: streamState.systemInstructions }])
      : undefined;
    if (captureContent && systemInstructionsJson) {
      span.setAttribute(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstructionsJson);
    }

    const versionExtras = stampAgentVersion(span, {
      systemInstructionsJson,
      toolDefinitionsJson,
      primaryModel: responseModel || requestModel,
      temperature: null,
      top_p: null,
      max_tokens: null,
    });

    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const effectiveModel = responseModel || requestModel;
    const cost = effectiveModel
      ? OpenLitHelper.getChatModelCost(effectiveModel, pricingInfo, usage.inputTokens, usage.outputTokens)
      : 0;
    if (cost) span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, cost);

    let outputMessagesJson: string | null = null;
    if (captureContent) {
      const resultText = result?.result || run.result;
      if (resultText && !streamState.assistantText) {
        streamState.assistantText = resultText;
      }
      outputMessagesJson = buildOutputMessages(streamState, finishReason);
      if (outputMessagesJson) {
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      }
    }

    if (error) {
      OpenLitHelper.handleException(span, error instanceof Error ? error : new Error(String(error)));
    } else if (status === 'error') {
      span.setAttribute(SemanticConvention.ERROR_TYPE, 'AgentError');
      span.setStatus({ code: SpanStatusCode.ERROR, message: result?.result || 'agent error' });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    const inputMessagesJson = captureContent ? buildInputMessages(message) : null;
    emitInvokeAgentEvent(
      span, agentId, requestModel, responseModel, finishReason,
      usage.inputTokens, usage.outputTokens, inputMessagesJson, outputMessagesJson,
      systemInstructionsJson ?? null, toolDefinitionsJson ?? null,
      versionExtras,
    );

    recordInvokeAgentMetrics(
      requestModel, usage.inputTokens, usage.outputTokens, cost, duration,
      error ? (error.constructor?.name || '_OTHER') : (status === 'error' ? 'AgentError' : undefined),
    );

    span.end();
  };

  return new Proxy(run, {
    get(target: any, prop: string | symbol, receiver: any) {
      if (prop === 'stream') {
        const originalStream = target.stream;
        if (typeof originalStream !== 'function') return originalStream;

        return function (...streamArgs: any[]) {
          isStreamMode = true;
          const generator = originalStream.apply(target, streamArgs);
          return wrapAsyncGenerator(generator, toolTracker, streamState, finalizeSpan);
        };
      }

      if (prop === 'wait') {
        const originalWait = target.wait;
        if (typeof originalWait !== 'function') return originalWait;

        return function (...waitArgs: any[]) {
          return originalWait.apply(target, waitArgs).then((result: any) => {
            finalizeSpan(result);
            return result;
          }).catch((e: any) => {
            finalizeSpan(undefined, e);
            throw e;
          });
        };
      }

      if (prop === 'cancel') {
        const originalCancel = target.cancel;
        if (typeof originalCancel !== 'function') return originalCancel;

        return function (...cancelArgs: any[]) {
          return originalCancel.apply(target, cancelArgs).then((result: any) => {
            finalizeSpan({ status: 'cancelled' });
            return result;
          });
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

// ---------------------------------------------------------------------------
// wrapAsyncGenerator -- wraps run.stream() to intercept SDKMessage events
// ---------------------------------------------------------------------------

async function* wrapAsyncGenerator(
  generator: AsyncGenerator<any>,
  toolTracker: ToolSpanTracker,
  streamState: StreamState,
  finalizeSpan: (result?: any, error?: any) => void,
): AsyncGenerator<any> {
  try {
    for await (const event of generator) {
      try {
        processStreamEvent(event, toolTracker, streamState);
      } catch { /* swallow processing errors */ }
      yield event;
    }
    finalizeSpan();
  } catch (e: any) {
    finalizeSpan(undefined, e);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// patchAgentCreate -- wraps Agent.create() for create_agent spans
// ---------------------------------------------------------------------------

export function patchAgentCreate(tracer: Tracer): (originalCreate: any) => any {
  return (originalCreate: any) => {
    return async function wrappedCreate(this: any, options: any) {
      const agentName = resolveAgentName(options);
      const modelId = resolveModelId(options);
      const displayName = agentName || 'cursor-agent';
      const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT} ${displayName}`;

      const span = tracer.startSpan(spanName, {
        kind: SpanKind.CLIENT,
        attributes: {
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
          [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_CURSOR,
          [SemanticConvention.SERVER_ADDRESS]: SERVER_ADDRESS,
          [SemanticConvention.SERVER_PORT]: SERVER_PORT,
        },
      });

      setCommonSpanAttributes(span);
      if (agentName) span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, agentName);
      if (modelId) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, modelId);

      const captureContent = OpenlitConfig.captureMessageContent ?? true;
      const instructionsText: string | null =
        (options && typeof options.instructions === 'string' && options.instructions) ||
        (options && typeof options.systemPrompt === 'string' && options.systemPrompt) ||
        null;
      if (captureContent && instructionsText) {
        span.setAttribute(
          SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
          JSON.stringify([{ type: 'text', content: instructionsText }]),
        );
      }
      const optionTools = Array.isArray(options?.tools) ? options.tools : undefined;
      const toolDefinitionsJson = OpenLitHelper.buildToolDefinitions(optionTools);
      if (toolDefinitionsJson) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_DEFINITIONS, toolDefinitionsJson);
      }

      applyCustomSpanAttributes(span);

      try {
        const agent = await originalCreate.call(this, options);

        const agentId = agent.agentId;
        if (agentId) {
          span.setAttribute(SemanticConvention.GEN_AI_AGENT_ID, agentId);
        }
        agentRegistry.register(agent, span.spanContext(), options);

        const resolvedModel = agent.model?.id || modelId;
        if (resolvedModel) span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, resolvedModel);

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();

        if (typeof agent.send === 'function') {
          const originalAgentSend = agent.send.bind(agent);
          agent.send = wrapSend(tracer, originalAgentSend, agentId, agentName, resolvedModel);
        }

        return agent;
      } catch (e: any) {
        OpenLitHelper.handleException(span, e);
        span.end();
        throw e;
      }
    };
  };
}

// ---------------------------------------------------------------------------
// patchAgentResume -- wraps Agent.resume() to patch send() on resumed agents
// ---------------------------------------------------------------------------

export function patchAgentResume(tracer: Tracer): (originalResume: any) => any {
  return (originalResume: any) => {
    return async function wrappedResume(this: any, agentId: string, options?: any) {
      const agentName = resolveAgentName(options);
      const modelId = resolveModelId(options);

      const agent = await originalResume.call(this, agentId, options);

      const resolvedAgentId = agent.agentId || agentId;
      const resolvedModel = agent.model?.id || modelId;

      if (typeof agent.send === 'function') {
        const originalAgentSend = agent.send.bind(agent);
        agent.send = wrapSend(tracer, originalAgentSend, resolvedAgentId, agentName, resolvedModel);
      }

      return agent;
    };
  };
}

