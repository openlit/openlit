/**
 * Claude Agent SDK wrapper — OTel GenAI semantic convention compliant.
 *
 * Wraps the `query()` async generator to produce `invoke_agent`, `execute_tool`,
 * and `chat` child spans. Tool spans are created via SDK hooks (PreToolUse /
 * PostToolUse / PostToolUseFailure). A message-based fallback handles cases
 * where hooks cannot be injected.
 *
 * Mirrors the Python SDK instrumentation in
 * sdk/python/src/openlit/instrumentation/claude_agent_sdk/.
 */

import {
  Tracer,
  Span,
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  trace,
} from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  applyCustomSpanAttributes,
  getServerAddressForProvider,
  setFrameworkLlmActive,
  resetFrameworkLlmActive,
} from '../../helpers';
import { SDK_NAME, SDK_VERSION } from '../../constant';
import Metrics from '../../otel/metrics';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const [SERVER_ADDRESS, SERVER_PORT] = getServerAddressForProvider('anthropic');
const GEN_AI_SYSTEM_ATTR = 'gen_ai.system';
const GEN_AI_SYSTEM_VALUE = 'anthropic';

const ANTHROPIC_FINISH_REASON_MAP: Record<string, string> = {
  end_turn: 'stop',
  max_tokens: 'length',
  stop_sequence: 'stop',
  tool_use: 'tool_call',
};

const OPERATION_MAP: Record<string, string> = {
  query: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  execute_tool: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
  subagent: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  chat: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
  create_agent: SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
};

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

function mapFinishReason(rawReason: string | null | undefined): string {
  if (!rawReason) return 'stop';
  return ANTHROPIC_FINISH_REASON_MAP[rawReason] || rawReason;
}

function resolveAgentName(options: any): string | null {
  if (!options) return null;
  for (const key of ['agent_name', 'agentName', 'name']) {
    const val = options[key];
    if (val && typeof val === 'string' && val.trim()) return val.trim();
  }
  return null;
}

function generateSpanName(endpoint: string, entityName?: string | null): string {
  const operation = OPERATION_MAP[endpoint] || SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT;
  if (entityName) return `${operation} ${entityName}`;
  return operation;
}

// ---------------------------------------------------------------------------
// Usage extraction from Anthropic BetaMessage.usage or ResultMessage.usage
// ---------------------------------------------------------------------------

interface UsageAttrs {
  [key: string]: number;
}

function extractUsage(usage: any): UsageAttrs {
  const attrs: UsageAttrs = {};
  if (!usage) return attrs;

  const rawInput = parseInt(usage.input_tokens, 10) || 0;
  const outputTokens = parseInt(usage.output_tokens, 10);
  if (!isNaN(outputTokens)) {
    attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = outputTokens;
  }

  let cacheReadInt = 0;
  const cacheRead = usage.cache_read_input_tokens;
  if (cacheRead != null) {
    cacheReadInt = parseInt(cacheRead, 10) || 0;
    if (cacheReadInt) {
      attrs[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] = cacheReadInt;
    }
  }

  let cacheCreationInt = 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens;
  if (cacheCreation != null) {
    cacheCreationInt = parseInt(cacheCreation, 10) || 0;
    if (cacheCreationInt) {
      attrs[SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] = cacheCreationInt;
    }
  }

  attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = rawInput + cacheReadInt + cacheCreationInt;
  return attrs;
}

// ---------------------------------------------------------------------------
// ToolSpanTracker — manages in-flight tool spans created by SDK hooks
// ---------------------------------------------------------------------------

class ToolSpanTracker {
  private _tracer: Tracer;
  private _parentSpan: Span;
  _inFlight = new Map<string, Span>();
  _completed = new Set<string>();
  private _captureContent: boolean;

  constructor(tracer: Tracer, parentSpan: Span, captureContent: boolean) {
    this._tracer = tracer;
    this._parentSpan = parentSpan;
    this._captureContent = captureContent;
  }

  startTool(toolName: string, toolInput: any, toolUseId: string): void {
    const spanName = generateSpanName('execute_tool', toolName);
    const parentCtx = trace.setSpan(otelContext.active(), this._parentSpan);

    const span = this._tracer.startSpan(spanName, {
      kind: SpanKind.INTERNAL,
      attributes: {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
      },
    }, parentCtx);

    setToolSpanAttributes(span, toolName, toolInput, toolUseId, this._captureContent);
    this._inFlight.set(toolUseId, span);
  }

  endTool(toolUseId: string, toolResponse?: any): void {
    const span = this._inFlight.get(toolUseId);
    if (!span) return;
    this._inFlight.delete(toolUseId);
    finalizeToolSpan(span, toolResponse, this._captureContent);
    span.end();
    this._completed.add(toolUseId);
  }

  endToolError(toolUseId: string, error?: string): void {
    const span = this._inFlight.get(toolUseId);
    if (!span) return;
    this._inFlight.delete(toolUseId);
    finalizeToolSpan(span, null, this._captureContent, true, error);
    span.end();
    this._completed.add(toolUseId);
  }

  endAll(): void {
    for (const [toolUseId, span] of this._inFlight) {
      finalizeToolSpan(span, null, this._captureContent, true, 'abandoned');
      span.end();
    }
    this._inFlight.clear();
  }
}

// ---------------------------------------------------------------------------
// SubagentSpanTracker — manages subagent spans for Task tool
// ---------------------------------------------------------------------------

class SubagentSpanTracker {
  private _tracer: Tracer;
  private _toolTracker: ToolSpanTracker;
  private _inFlight = new Map<string, Span>();
  private _toolUseToTask = new Map<string, string>();

  constructor(tracer: Tracer, toolTracker: ToolSpanTracker) {
    this._tracer = tracer;
    this._toolTracker = toolTracker;
  }

  startSubagent(taskId: string, description: string | null, toolUseId?: string): void {
    const name = description || taskId || 'subagent';
    const spanName = generateSpanName('subagent', name);

    if (toolUseId) {
      this._toolUseToTask.set(toolUseId, taskId);
    }

    let parentSpan: Span | undefined;
    if (toolUseId) {
      parentSpan = this._toolTracker._inFlight.get(toolUseId);
    }

    const ctx = parentSpan ? trace.setSpan(otelContext.active(), parentSpan) : undefined;

    const span = this._tracer.startSpan(spanName, {
      kind: SpanKind.INTERNAL,
      attributes: {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
      },
    }, ctx);

    span.setAttribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE);
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, String(name));
    span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment ?? 'default');
    span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName ?? 'default');
    span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);

    this._inFlight.set(taskId, span);
  }

  endSubagent(taskId: string, isError = false, errorMessage?: string | null, usage?: any): void {
    const span = this._inFlight.get(taskId);
    if (!span) return;
    this._inFlight.delete(taskId);

    if (usage) {
      if (usage.total_tokens != null) {
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, Number(usage.total_tokens) || 0);
      }
      if (usage.tool_uses != null) {
        span.setAttribute('gen_ai.agent.tool_uses', Number(usage.tool_uses) || 0);
      }
      if (usage.duration_ms != null) {
        span.setAttribute('gen_ai.agent.duration_ms', Number(usage.duration_ms) || 0);
      }
    }

    if (isError) {
      const err = errorMessage ? String(errorMessage) : 'task failed';
      span.setAttribute(SemanticConvention.ERROR_TYPE, 'SubagentError');
      span.setStatus({ code: SpanStatusCode.ERROR, message: err });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  }

  getSpanForToolUseId(toolUseId: string): Span | undefined {
    const taskId = this._toolUseToTask.get(toolUseId);
    return taskId ? this._inFlight.get(taskId) : undefined;
  }

  endAll(): void {
    for (const taskId of this._inFlight.keys()) {
      this.endSubagent(taskId, true, 'abandoned');
    }
  }
}

// ---------------------------------------------------------------------------
// Tool span attributes
// ---------------------------------------------------------------------------

function setToolSpanAttributes(
  span: Span,
  toolName: string,
  toolInput: any,
  toolUseId: string,
  captureContent: boolean,
): void {
  span.setAttribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE);
  span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, String(toolName));
  const toolType = String(toolName).startsWith('mcp__') ? 'extension' : 'function';
  span.setAttribute(SemanticConvention.GEN_AI_TOOL_TYPE, toolType);

  if (toolUseId) {
    span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, String(toolUseId));
  }

  span.setAttribute(SemanticConvention.SERVER_ADDRESS, SERVER_ADDRESS);
  span.setAttribute(SemanticConvention.SERVER_PORT, SERVER_PORT);
  span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment ?? 'default');
  span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName ?? 'default');
  span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);

  if (captureContent && toolInput != null) {
    try {
      const argsStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, truncateContent(argsStr));
    } catch { /* ignore */ }
  }

  applyCustomSpanAttributes(span);
}

function finalizeToolSpan(
  span: Span,
  toolResponse: any,
  captureContent: boolean,
  isError = false,
  errorMessage?: string | null,
): void {
  if (isError) {
    const errMsg = errorMessage ? String(errorMessage) : 'tool execution failed';
    span.setAttribute(SemanticConvention.ERROR_TYPE, 'ToolExecutionError');
    span.setStatus({ code: SpanStatusCode.ERROR, message: errMsg });
  } else {
    if (captureContent && toolResponse != null) {
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_RESULT, truncateContent(String(toolResponse)));
    }
    span.setStatus({ code: SpanStatusCode.OK });
  }
}

// ---------------------------------------------------------------------------
// Hook injection — merges OpenLIT hooks into user-provided options
// ---------------------------------------------------------------------------

function injectHooks(
  options: any,
  toolTracker: ToolSpanTracker,
  subagentTracker: SubagentSpanTracker,
): void {
  if (!options.hooks) {
    options.hooks = {};
  }

  const preToolUse = async (input: any, toolUseId: string | undefined) => {
    try {
      const toolName = input.tool_name || 'unknown';
      const toolInput = input.tool_input;
      const id = toolUseId || input.tool_use_id;
      if (id) toolTracker.startTool(toolName, toolInput, id);
    } catch { /* swallow */ }
    return {};
  };

  const postToolUse = async (input: any, toolUseId: string | undefined) => {
    try {
      const toolResponse = input.tool_response;
      const id = toolUseId || input.tool_use_id;
      if (id) toolTracker.endTool(id, toolResponse);
    } catch { /* swallow */ }
    return {};
  };

  const postToolUseFailure = async (input: any, toolUseId: string | undefined) => {
    try {
      const error = input.error || 'unknown error';
      const id = toolUseId || input.tool_use_id;
      if (id) toolTracker.endToolError(id, error);
    } catch { /* swallow */ }
    return {};
  };

  const subagentStart = async (input: any, toolUseId: string | undefined) => {
    try {
      const agentId = input.agent_id;
      if (agentId) {
        const description = input.description || agentId;
        subagentTracker.startSubagent(agentId, description, toolUseId ?? undefined);
      }
    } catch { /* swallow */ }
    return {};
  };

  const subagentStop = async (input: any) => {
    try {
      const agentId = input.agent_id;
      if (!agentId) return {};
      const error = input.error;
      subagentTracker.endSubagent(agentId, !!error, error);
    } catch { /* swallow */ }
    return {};
  };

  const hookPairs: [string, Function][] = [
    ['PreToolUse', preToolUse],
    ['PostToolUse', postToolUse],
    ['PostToolUseFailure', postToolUseFailure],
    ['SubagentStart', subagentStart],
    ['SubagentStop', subagentStop],
  ];

  for (const [event, callback] of hookPairs) {
    const matcher = { hooks: [callback] };
    if (options.hooks[event]) {
      options.hooks[event].push(matcher);
    } else {
      options.hooks[event] = [matcher];
    }
  }
}

// ---------------------------------------------------------------------------
// Chat child span — deferred creation for correct content & ordering
// ---------------------------------------------------------------------------

interface ChatState {
  pendingChatMsg?: any;
  pendingChatMsgId?: string;
  pendingStartMs?: number;
  pendingEndMs?: number;
  pendingInput?: any[];
  lastBoundaryMs: number;
}

function hasLlmCallData(msg: any): boolean {
  return msg.message?.model != null && msg.message?.usage != null;
}

function bufferChatMessage(sdkMsg: any, chatState: ChatState): void {
  if (!hasLlmCallData(sdkMsg)) return;
  chatState.pendingChatMsg = sdkMsg;
  chatState.pendingChatMsgId = sdkMsg.message?.id;
  chatState.pendingStartMs = chatState.lastBoundaryMs;
  chatState.pendingEndMs = Date.now();
}

function flushPendingChat(
  tracer: Tracer,
  parentSpan: Span,
  chatState: ChatState,
  captureContent: boolean,
  subagentTracker: SubagentSpanTracker,
): void {
  const sdkMsg = chatState.pendingChatMsg;
  if (!sdkMsg) return;

  delete chatState.pendingChatMsg;
  delete chatState.pendingChatMsgId;
  const endMs = chatState.pendingEndMs ?? Date.now();
  const savedStartMs = chatState.pendingStartMs;
  delete chatState.pendingStartMs;
  delete chatState.pendingEndMs;

  const betaMessage = sdkMsg.message;
  const model = String(betaMessage?.model || 'unknown');
  const spanName = generateSpanName('chat', model);

  let effectiveParent = parentSpan;
  const parentToolUseId = sdkMsg.parent_tool_use_id;
  if (parentToolUseId) {
    const subagentSpan = subagentTracker.getSpanForToolUseId(parentToolUseId);
    if (subagentSpan) effectiveParent = subagentSpan;
  }

  const parentCtx = trace.setSpan(otelContext.active(), effectiveParent);
  const startMs = savedStartMs ?? chatState.lastBoundaryMs ?? endMs;

  const chatSpan = tracer.startSpan(spanName, {
    kind: SpanKind.CLIENT,
    attributes: {
      [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
      [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC,
    },
    startTime: new Date(startMs),
  }, parentCtx);

  const inputMessages = chatState.pendingInput;
  delete chatState.pendingInput;

  setChatSpanAttributes(chatSpan, sdkMsg, captureContent, inputMessages);
  chatSpan.end(new Date(endMs));
  chatState.lastBoundaryMs = endMs;
}

// ---------------------------------------------------------------------------
// Chat span attributes
// ---------------------------------------------------------------------------

function setChatSpanAttributes(
  span: Span,
  sdkMsg: any,
  captureContent: boolean,
  inputMessages?: any[] | null,
): void {
  try {
    const betaMessage = sdkMsg.message;
    const model = betaMessage?.model ? String(betaMessage.model) : null;

    span.setAttribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, SERVER_ADDRESS);
    span.setAttribute(SemanticConvention.SERVER_PORT, SERVER_PORT);
    span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
    span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment ?? 'default');
    span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName ?? 'default');
    span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);

    if (model) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model);
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, model);
    }

    const usage = betaMessage?.usage;
    const usageAttrs = usage ? extractUsage(usage) : {};
    for (const [key, value] of Object.entries(usageAttrs)) {
      span.setAttribute(key, value);
    }

    let stopReason = betaMessage?.stop_reason;
    if (!stopReason) {
      const content = betaMessage?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            stopReason = 'tool_use';
            break;
          }
        }
      }
    }
    const mappedReason = mapFinishReason(stopReason);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [mappedReason]);

    const messageId = betaMessage?.id;
    if (messageId) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, String(messageId));
    }

    const sessionId = sdkMsg.session_id;
    if (sessionId) {
      span.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, String(sessionId));
    }

    const inputTokens = usageAttrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] ?? 0;
    const outputTokens = usageAttrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] ?? 0;
    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = model ? OpenLitHelper.getChatModelCost(model, pricingInfo, inputTokens, outputTokens) : 0;
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, cost);

    let outputMessages: any[] | null = null;
    if (captureContent) {
      if (inputMessages) {
        span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, JSON.stringify(inputMessages));
      }
      outputMessages = buildOutputMessages(betaMessage, mappedReason);
      if (outputMessages) {
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(outputMessages));
      }
    }

    applyCustomSpanAttributes(span);
    span.setStatus({ code: SpanStatusCode.OK });

    if (captureContent) {
      emitChatInferenceEvent(span, model, messageId, sessionId, mappedReason, usageAttrs, inputMessages, outputMessages);
    }

    if (!OpenlitConfig.disableMetrics) {
      recordChatMetrics(model, inputTokens, outputTokens, cost);
    }
  } catch { /* swallow */ }
}

// ---------------------------------------------------------------------------
// Build OTel-compliant output messages from BetaMessage content blocks
// ---------------------------------------------------------------------------

function buildOutputMessages(betaMessage: any, mappedFinishReason: string): any[] | null {
  try {
    const content = betaMessage?.content;
    if (!content || !Array.isArray(content)) return null;

    const parts: any[] = [];
    for (const block of content) {
      if (block.type === 'text') {
        if (block.text) {
          parts.push({ type: 'text', content: truncateContent(String(block.text)) });
        }
      } else if (block.type === 'thinking') {
        if (block.thinking) {
          parts.push({ type: 'reasoning', content: truncateContent(String(block.thinking)) });
        }
      } else if (block.type === 'tool_use') {
        let toolInput = block.input || {};
        if (typeof toolInput !== 'object') {
          try { toolInput = JSON.parse(String(toolInput)); } catch { toolInput = {}; }
        }
        parts.push({
          type: 'tool_call',
          id: String(block.id || ''),
          name: String(block.name || 'unknown'),
          arguments: toolInput,
        });
      }
    }

    if (parts.length === 0) return null;
    return [{ role: 'assistant', parts, finish_reason: mappedFinishReason }];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build OTel input from UserMessage tool results
// ---------------------------------------------------------------------------

function buildInputFromToolResults(sdkMsg: any): any[] | null {
  try {
    const messageParam = sdkMsg.message;
    const content = messageParam?.content;
    if (!content || !Array.isArray(content)) return null;

    const parts: any[] = [];
    for (const block of content) {
      if (block.type === 'tool_result') {
        const toolUseId = block.tool_use_id;
        let resultContent = block.content;
        if (Array.isArray(resultContent)) {
          resultContent = resultContent.map((c: any) => c.text || JSON.stringify(c)).join('');
        }
        parts.push({
          type: 'tool_call_response',
          id: toolUseId ? String(toolUseId) : '',
          response: resultContent ? truncateContent(String(resultContent)) : '',
        });
      }
    }

    if (parts.length === 0) return null;
    return [{ role: 'user', parts }];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Emit gen_ai.client.inference.operation.details event for chat spans
// ---------------------------------------------------------------------------

function emitChatInferenceEvent(
  span: Span,
  model: string | null,
  messageId: string | null,
  sessionId: string | null,
  mappedReason: string,
  usageAttrs: UsageAttrs,
  inputMessages?: any[] | null,
  outputMessages?: any[] | null,
): void {
  if (OpenlitConfig.disableEvents) return;

  try {
    const attributes: Record<string, any> = {
      [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
      [SemanticConvention.SERVER_ADDRESS]: SERVER_ADDRESS,
      [SemanticConvention.SERVER_PORT]: SERVER_PORT,
    };

    if (model) {
      attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = model;
      attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] = model;
    }
    if (messageId) {
      attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = String(messageId);
    }
    if (sessionId) {
      attributes[SemanticConvention.GEN_AI_CONVERSATION_ID] = String(sessionId);
    }
    if (mappedReason) {
      attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = [mappedReason];
    }

    for (const [key, value] of Object.entries(usageAttrs)) {
      attributes[key] = value;
    }

    if (inputMessages != null) {
      attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessages;
    }
    if (outputMessages != null) {
      attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessages;
    }

    OpenLitHelper.emitInferenceEvent(span, attributes);
  } catch { /* swallow */ }
}

// ---------------------------------------------------------------------------
// Chat metrics
// ---------------------------------------------------------------------------

function recordChatMetrics(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cost: number,
): void {
  try {
    const attributes: Record<string, any> = {
      [ATTR_TELEMETRY_SDK_NAME]: SDK_NAME,
      [ATTR_SERVICE_NAME]: OpenlitConfig.applicationName ?? 'default',
      [SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]: OpenlitConfig.environment ?? 'default',
      [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC,
      [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
      [SemanticConvention.SERVER_ADDRESS]: SERVER_ADDRESS,
      [SemanticConvention.SERVER_PORT]: SERVER_PORT,
    };
    if (model) {
      attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = model;
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
// Process result message — finalize root span with usage/cost data
// ---------------------------------------------------------------------------

function processResultMessage(span: Span, sdkMsg: any, captureContent: boolean): { inputTokens: number; outputTokens: number } {
  const resultUsage = { inputTokens: 0, outputTokens: 0 };
  try {
    const sessionId = sdkMsg.session_id;
    if (sessionId) {
      span.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, String(sessionId));
    }

    const usage = sdkMsg.usage;
    if (usage) {
      const usageAttrs = extractUsage(usage);
      for (const [key, value] of Object.entries(usageAttrs)) {
        span.setAttribute(key, value);
      }
      resultUsage.inputTokens = usageAttrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] ?? 0;
      resultUsage.outputTokens = usageAttrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] ?? 0;
    }

    const totalCost = sdkMsg.total_cost_usd;
    if (totalCost != null) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, Number(totalCost) || 0);
    }

    const modelUsage = sdkMsg.modelUsage;
    if (modelUsage && typeof modelUsage === 'object') {
      const modelNames = Object.keys(modelUsage);
      if (modelNames.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, String(modelNames[0]));
      }
    }

    if (sdkMsg.num_turns != null) {
      span.setAttribute('gen_ai.agent.num_turns', Number(sdkMsg.num_turns) || 0);
    }
    if (sdkMsg.duration_ms != null) {
      span.setAttribute('gen_ai.agent.duration_ms', Number(sdkMsg.duration_ms) || 0);
    }
    if (sdkMsg.duration_api_ms != null) {
      span.setAttribute('gen_ai.agent.duration_api_ms', Number(sdkMsg.duration_api_ms) || 0);
    }

    if (sdkMsg.is_error) {
      const errResult = sdkMsg.errors?.join('; ') || sdkMsg.result || 'unknown error';
      span.setAttribute(SemanticConvention.ERROR_TYPE, 'AgentError');
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(errResult) });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    if (captureContent) {
      const result = sdkMsg.result;
      if (result) {
        span.setAttribute(
          SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
          JSON.stringify([{
            role: 'assistant',
            parts: [{ type: 'text', content: truncateContent(String(result)) }],
          }]),
        );
      }
    }
  } catch { /* swallow */ }

  return resultUsage;
}

// ---------------------------------------------------------------------------
// Message stream processor
// ---------------------------------------------------------------------------

function processMessage(
  sdkMsg: any,
  span: Span,
  toolTracker: ToolSpanTracker,
  subagentTracker: SubagentSpanTracker,
  captureContent: boolean,
  tracer: Tracer,
  chatState: ChatState,
): { inputTokens: number; outputTokens: number } | null {
  const msgType = sdkMsg.type;
  let resultUsage: { inputTokens: number; outputTokens: number } | null = null;

  if (msgType === 'assistant') {
    updateRootFromAssistant(span, sdkMsg);

    if (hasLlmCallData(sdkMsg)) {
      const newMsgId = sdkMsg.message?.id;
      const pendingMsgId = chatState.pendingChatMsgId;
      if (pendingMsgId != null && newMsgId !== pendingMsgId) {
        flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
      }
      bufferChatMessage(sdkMsg, chatState);
    }
  } else if (msgType === 'user') {
    flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
    if (captureContent) {
      const toolInput = buildInputFromToolResults(sdkMsg);
      if (toolInput) {
        chatState.pendingInput = toolInput;
      }
    }
  } else if (msgType === 'result') {
    flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
    resultUsage = processResultMessage(span, sdkMsg, captureContent);
  } else if (msgType === 'system' && sdkMsg.subtype === 'task_started') {
    flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
    try {
      const taskId = sdkMsg.task_id;
      const description = sdkMsg.description;
      const toolUseId = sdkMsg.tool_use_id;
      if (taskId) {
        subagentTracker.startSubagent(taskId, description, toolUseId);
      }
    } catch { /* swallow */ }
  } else if (msgType === 'system' && sdkMsg.subtype === 'task_notification') {
    flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
    try {
      const taskId = sdkMsg.task_id;
      const status = sdkMsg.status;
      const isError = status === 'failed' || status === 'stopped';
      const errorMsg = isError ? sdkMsg.summary : null;
      const taskUsage = sdkMsg.usage;
      if (taskId) {
        subagentTracker.endSubagent(taskId, isError, errorMsg, taskUsage);
      }
    } catch { /* swallow */ }
  }

  chatState.lastBoundaryMs = Date.now();
  return resultUsage;
}

function updateRootFromAssistant(span: Span, sdkMsg: any): void {
  try {
    const model = sdkMsg.message?.model;
    if (model) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, String(model));
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, String(model));
    }
    const sessionId = sdkMsg.session_id;
    if (sessionId) {
      span.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, String(sessionId));
    }
  } catch { /* swallow */ }
}

// ---------------------------------------------------------------------------
// Message-based tool span fallback (when hooks don't fire)
// ---------------------------------------------------------------------------

function processToolBlocksFromMessages(
  sdkMsg: any,
  toolTracker: ToolSpanTracker,
  subagentTracker: SubagentSpanTracker,
): void {
  const msgType = sdkMsg.type;

  if (msgType === 'assistant') {
    const content = sdkMsg.message?.content;
    if (!content || !Array.isArray(content)) return;

    const parentToolUseId = sdkMsg.parent_tool_use_id;
    let effectiveParent: Span | undefined;
    if (parentToolUseId) {
      effectiveParent = subagentTracker.getSpanForToolUseId(parentToolUseId);
    }

    for (const block of content) {
      if (block.type === 'tool_use') {
        const toolName = block.name || 'unknown';
        const toolInput = block.input;
        const toolId = block.id;
        if (toolId && !toolTracker._inFlight.has(toolId) && !toolTracker._completed.has(toolId)) {
          if (effectiveParent) {
            const spanName = generateSpanName('execute_tool', toolName);
            const parentCtx = trace.setSpan(otelContext.active(), effectiveParent);
            const span = toolTracker['_tracer'].startSpan(spanName, {
              kind: SpanKind.INTERNAL,
              attributes: {
                [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
                [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
              },
            }, parentCtx);
            setToolSpanAttributes(span, toolName, toolInput, toolId, OpenlitConfig.captureMessageContent ?? true);
            toolTracker._inFlight.set(toolId, span);
          } else {
            toolTracker.startTool(toolName, toolInput, toolId);
          }
        }
      }
    }
  } else if (msgType === 'user') {
    const content = sdkMsg.message?.content;
    if (!content || !Array.isArray(content)) return;
    for (const block of content) {
      if (block.type === 'tool_result') {
        const toolUseId = block.tool_use_id;
        const isError = block.is_error;
        const resultContent = block.content;
        if (toolUseId && toolTracker._inFlight.has(toolUseId)) {
          if (isError) {
            toolTracker.endToolError(toolUseId, resultContent);
          } else {
            toolTracker.endTool(toolUseId, resultContent);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Set initial span attributes on the root invoke_agent span
// ---------------------------------------------------------------------------

function setInitialSpanAttributes(
  span: Span,
  options: any,
  prompt: any,
  captureContent: boolean,
): void {
  try {
    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT);
    span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK);
    span.setAttribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE);
    span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
    span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment ?? 'default');
    span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName ?? 'default');
    span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, SERVER_ADDRESS);
    span.setAttribute(SemanticConvention.SERVER_PORT, SERVER_PORT);

    const agentName = resolveAgentName(options);
    if (agentName) {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, agentName);
    }

    const model = options?.model;
    if (model) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, String(model));
    }

    if (captureContent) {
      const systemPrompt = options?.systemPrompt;
      if (systemPrompt && typeof systemPrompt === 'string') {
        span.setAttribute(
          SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
          JSON.stringify([{ type: 'text', content: truncateContent(systemPrompt) }]),
        );
      }

      if (prompt && typeof prompt === 'string') {
        span.setAttribute(
          SemanticConvention.GEN_AI_INPUT_MESSAGES,
          JSON.stringify([{
            role: 'user',
            parts: [{ type: 'text', content: truncateContent(prompt) }],
          }]),
        );
      }
    }

    applyCustomSpanAttributes(span);
  } catch { /* swallow */ }
}

// ---------------------------------------------------------------------------
// Finalize root span — record duration and token usage metrics
// ---------------------------------------------------------------------------

function finalizeSpan(
  span: Span,
  startTime: number,
  inputTokens: number,
  outputTokens: number,
): void {
  try {
    const duration = (Date.now() / 1000) - startTime;
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);

    if (!OpenlitConfig.disableMetrics) {
      const attributes: Record<string, any> = {
        [ATTR_TELEMETRY_SDK_NAME]: SDK_NAME,
        [ATTR_SERVICE_NAME]: OpenlitConfig.applicationName ?? 'default',
        [SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]: OpenlitConfig.environment ?? 'default',
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
        [GEN_AI_SYSTEM_ATTR]: GEN_AI_SYSTEM_VALUE,
        [SemanticConvention.SERVER_ADDRESS]: SERVER_ADDRESS,
        [SemanticConvention.SERVER_PORT]: SERVER_PORT,
      };

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
    }
  } catch { /* swallow */ }
}

// ---------------------------------------------------------------------------
// patchQuery — wraps the `query()` export from @anthropic-ai/claude-agent-sdk
// ---------------------------------------------------------------------------

export function patchQuery(tracer: Tracer): (originalQuery: any) => any {
  return (originalQuery: any) => {
    return function wrappedQuery(this: any, params: { prompt: any; options?: any }) {
      const captureContent = OpenlitConfig.captureMessageContent ?? true;
      const prompt = params.prompt;
      const userOptions = params.options;
      const options = userOptions ? { ...userOptions } : {};

      const agentName = resolveAgentName(options);
      const spanName = generateSpanName('query', agentName);

      const span = tracer.startSpan(spanName, {
        kind: SpanKind.INTERNAL,
        attributes: {
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
          [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
        },
      });

      const spanContext = trace.setSpan(otelContext.active(), span);
      const startTime = Date.now() / 1000;
      const chatState: ChatState = { lastBoundaryMs: Date.now() };
      const toolTracker = new ToolSpanTracker(tracer, span, captureContent);
      const subagentTracker = new SubagentSpanTracker(tracer, toolTracker);
      const aggregateUsage = { inputTokens: 0, outputTokens: 0 };

      if (prompt && typeof prompt === 'string' && captureContent) {
        chatState.pendingInput = [{
          role: 'user',
          parts: [{ type: 'text', content: truncateContent(prompt) }],
        }];
      }

      injectHooks(options, toolTracker, subagentTracker);
      setInitialSpanAttributes(span, options, prompt, captureContent);

      setFrameworkLlmActive();

      let query: any;
      try {
        query = otelContext.with(spanContext, () => {
          return originalQuery.call(this, { prompt, options });
        });
      } catch (e: any) {
        resetFrameworkLlmActive();
        OpenLitHelper.handleException(span, e);
        span.end();
        throw e;
      }

      let done = false;

      const cleanup = () => {
        if (done) return;
        done = true;
        resetFrameworkLlmActive();
        subagentTracker.endAll();
        toolTracker.endAll();
        finalizeSpan(span, startTime, aggregateUsage.inputTokens, aggregateUsage.outputTokens);
        span.end();
      };

      const originalNext = query.next.bind(query);
      const originalReturn = query.return?.bind(query);
      const originalThrow = query.throw?.bind(query);

      return new Proxy(query, {
        get(target: any, prop: string | symbol, receiver: any) {
          if (prop === 'next') {
            return async function (...args: any[]) {
              try {
                const result = await originalNext(...args);
                if (result.done) {
                  if (!done) {
                    flushPendingChat(tracer, span, chatState, captureContent, subagentTracker);
                    if (aggregateUsage.inputTokens === 0 && aggregateUsage.outputTokens === 0) {
                      span.setStatus({ code: SpanStatusCode.OK });
                    }
                  }
                  cleanup();
                  return result;
                }

                const sdkMsg = result.value;
                try {
                  const msgUsage = processMessage(
                    sdkMsg, span, toolTracker, subagentTracker,
                    captureContent, tracer, chatState,
                  );
                  if (msgUsage) {
                    aggregateUsage.inputTokens = msgUsage.inputTokens;
                    aggregateUsage.outputTokens = msgUsage.outputTokens;
                  }
                  processToolBlocksFromMessages(sdkMsg, toolTracker, subagentTracker);
                } catch { /* swallow processing errors */ }

                return result;
              } catch (e: any) {
                if (!done) {
                  OpenLitHelper.handleException(span, e);
                }
                cleanup();
                throw e;
              }
            };
          }

          if (prop === 'return') {
            return async function (value?: any) {
              cleanup();
              return originalReturn ? originalReturn(value) : { done: true as const, value };
            };
          }

          if (prop === 'throw') {
            return async function (e?: any) {
              if (!done) {
                OpenLitHelper.handleException(span, e instanceof Error ? e : new Error(String(e)));
              }
              cleanup();
              return originalThrow ? originalThrow(e) : { done: true as const, value: undefined };
            };
          }

          if (prop === Symbol.asyncIterator) {
            return function () { return receiver; };
          }

          return Reflect.get(target, prop, receiver);
        },
      });
    };
  };
}
