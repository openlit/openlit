/**
 * OpenAI Agents utilities for OTel GenAI semantic convention compliant telemetry.
 *
 * Maps SDK span types to OTel operation names, determines SpanKind,
 * generates span names, and sets type-specific attributes on OTel spans.
 *
 * All attribute setting happens at on_span_end (when span data is fully
 * populated), matching the Python SDK pattern.
 */

import { Span as OtelSpan, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import SemanticConvention from '../../semantic-convention';
import { SDK_NAME, SDK_VERSION } from '../../constant';
import OpenlitConfig from '../../config';
import Metrics from '../../otel/metrics';
import { applyCustomSpanAttributes, getServerAddressForProvider } from '../../helpers';

const [OPENAI_SERVER_ADDRESS, OPENAI_SERVER_PORT] = getServerAddressForProvider('openai');

// SDK span_data.type -> gen_ai.operation.name
const OPERATION_MAP: Record<string, string> = {
  agent: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  generation: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
  response: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
  function: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
  handoff: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  guardrail: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  custom: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  transcription: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
  speech: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
  speech_group: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
  mcp_tools: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
};

// SpanKind per operation (OTel GenAI spec)
const SPAN_KIND_MAP: Record<string, SpanKind> = {
  [SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK]: SpanKind.INTERNAL,
  [SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT]: SpanKind.INTERNAL,
  [SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS]: SpanKind.INTERNAL,
  [SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT]: SpanKind.CLIENT,
};

const MAX_HANDOFFS = 1000;

export function getOperationType(spanType: string): string {
  return OPERATION_MAP[spanType] ?? SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT;
}

export function getSpanKind(operationType: string): SpanKind {
  return SPAN_KIND_MAP[operationType] ?? SpanKind.INTERNAL;
}

export function generateSpanName(spanData: any): string {
  const spanType: string = spanData?.type ?? 'unknown';
  const operation = getOperationType(spanType);

  if (spanType === 'agent') {
    const name = spanData.name ?? 'agent';
    return `${operation} ${name}`;
  }

  if (spanType === 'generation' || spanType === 'response') {
    const model = extractModelFromSpanData(spanData);
    return model ? `${operation} ${model}` : operation;
  }

  if (spanType === 'function') {
    const name = spanData.name ?? 'function';
    return `${operation} ${name}`;
  }

  if (spanType === 'handoff') {
    const toAgent = spanData.toAgent ?? spanData.to_agent ?? 'unknown';
    return `${operation} ${toAgent}`;
  }

  if (spanType === 'guardrail') {
    const name = spanData.name ?? 'guardrail';
    return `${operation} ${name}`;
  }

  if (spanType === 'mcp_tools') {
    return `${operation} mcp_list_tools`;
  }

  if (spanType === 'transcription') return `${operation} transcription`;
  if (spanType === 'speech') return `${operation} speech`;
  if (spanType === 'speech_group') return `${operation} speech_group`;

  if (spanType === 'custom') {
    const name = spanData.name ?? 'custom';
    return `${operation} ${name}`;
  }

  return operation;
}

/**
 * Set all OTel-compliant attributes on the OTel span using fully-populated SDK data.
 * Called from on_span_end in the processor.
 */
export function processSpanEnd(
  otelSpan: OtelSpan,
  sdkSpan: any,
  startTime: number,
  conversationId: string | null,
  handoffTracker: Map<string, string>,
): void {
  try {
    const endTime = Date.now();
    const spanData = sdkSpan.spanData;
    const spanType: string = spanData?.type ?? 'unknown';
    const operation = getOperationType(spanType);
    const modelName = extractModelFromSpanData(spanData);

    const updatedName = generateSpanName(spanData);
    try {
      otelSpan.updateName(updatedName);
    } catch {
      // updateName may not be available on all span implementations
    }

    setCommonFrameworkAttributes(otelSpan, operation, modelName, endTime - startTime);

    otelSpan.setAttribute(SemanticConvention.GEN_AI_OPERATION, operation);
    otelSpan.setAttribute(
      SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL,
      SemanticConvention.GEN_AI_SYSTEM_OPENAI,
    );

    if (conversationId) {
      otelSpan.setAttribute(SemanticConvention.GEN_AI_CONVERSATION_ID, conversationId);
    }

    if (modelName) {
      otelSpan.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, modelName);
    }

    // Dispatch to type-specific handler
    const captureContent = OpenlitConfig.captureMessageContent ?? true;
    if (spanType === 'agent') {
      setAgentAttributes(otelSpan, spanData, captureContent);
    } else if (spanType === 'response') {
      setResponseAttributes(otelSpan, spanData, captureContent);
    } else if (spanType === 'generation') {
      setGenerationAttributes(otelSpan, spanData, captureContent);
    } else if (spanType === 'function') {
      setFunctionAttributes(otelSpan, spanData, captureContent);
    } else if (spanType === 'handoff') {
      setHandoffAttributes(otelSpan, spanData, handoffTracker, sdkSpan.traceId ?? '');
    } else if (spanType === 'guardrail') {
      setGuardrailAttributes(otelSpan, spanData);
    } else if (spanType === 'transcription') {
      setTranscriptionAttributes(otelSpan, spanData, captureContent);
    } else if (spanType === 'speech') {
      setSpeechAttributes(otelSpan, spanData, captureContent);
    } else if (spanType === 'mcp_tools') {
      setMcpToolsAttributes(otelSpan, spanData);
    } else if (spanType === 'custom') {
      setCustomAttributes(otelSpan, spanData);
    }

    // Error handling
    const error = sdkSpan.error;
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
      recordMetrics(operation, (endTime - startTime) / 1000, modelName);
    }
  } catch {
    // Swallow to avoid breaking the agent run
  }
}

// ---------------------------------------------------------------------------
// Common framework span attributes (mirrors Python common_framework_span_attributes)
// ---------------------------------------------------------------------------
function setCommonFrameworkAttributes(
  span: OtelSpan,
  operation: string,
  modelName: string | null,
  durationMs: number,
): void {
  span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
  span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
  span.setAttribute(
    SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL,
    SemanticConvention.GEN_AI_SYSTEM_OPENAI,
  );
  span.setAttribute(SemanticConvention.GEN_AI_OPERATION, operation);
  if (modelName) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, modelName);
  }
  if (OPENAI_SERVER_ADDRESS) {
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
    if (OPENAI_SERVER_PORT) {
      span.setAttribute(SemanticConvention.SERVER_PORT, OPENAI_SERVER_PORT);
    }
  }
  span.setAttribute(
    SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT,
    OpenlitConfig.environment ?? 'default',
  );
  span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName ?? 'default');
  span.setAttribute(
    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
    durationMs / 1000,
  );
  applyCustomSpanAttributes(span);
}

// ---------------------------------------------------------------------------
// Agent (invoke_agent)
// ---------------------------------------------------------------------------
function setAgentAttributes(span: OtelSpan, spanData: any, captureContent: boolean): void {
  try {
    const name = spanData.name;
    if (name) {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, String(name));
    }

    const agentId = spanData.agentId ?? spanData.agent_id;
    if (agentId && typeof agentId === 'string') {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_ID, agentId);
    }

    const outputType = spanData.outputType ?? spanData.output_type;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, mapOutputType(outputType));

    if (captureContent) {
      const tools: any[] | undefined = spanData.tools;
      if (tools && tools.length > 0) {
        const toolDefs = tools.slice(0, 20).map((t: any) => ({
          type: 'function',
          name: String(typeof t === 'string' ? t : t),
        }));
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_DEFINITIONS, JSON.stringify(toolDefs));
      }

      const handoffs: any[] | undefined = spanData.handoffs;
      if (handoffs && handoffs.length > 0) {
        span.setAttribute(
          'gen_ai.agent.handoffs',
          JSON.stringify(handoffs.slice(0, 20).map(String)),
        );
      }
    }
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Response (chat -- Response API)
// ---------------------------------------------------------------------------
function setResponseAttributes(span: OtelSpan, spanData: any, captureContent: boolean): void {
  try {
    const response = spanData.response;
    if (!response) return;

    const model = response.model;
    if (model) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, String(model));
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, String(model));
    }

    const respId = response.id;
    if (respId) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, String(respId));
    }

    const usage = response.usage;
    if (usage) {
      const inputTokens = usage.input_tokens ?? usage.inputTokens;
      const outputTokens = usage.output_tokens ?? usage.outputTokens;
      if (inputTokens != null) {
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
      }
      if (outputTokens != null) {
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
      }
    }

    const outputItems = response.output;
    if (Array.isArray(outputItems)) {
      const finishReasons: string[] = [];
      for (const item of outputItems) {
        const status = item.status;
        if (status) finishReasons.push(String(status));
      }
      if (finishReasons.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, finishReasons);
      }
    }

    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
    span.setAttribute(SemanticConvention.SERVER_PORT, OPENAI_SERVER_PORT);

    if (captureContent) {
      captureResponseMessages(span, spanData, response);
    }
  } catch {
    // swallow
  }
}

function captureResponseMessages(span: OtelSpan, spanData: any, response: any): void {
  try {
    const rawInput = spanData.input;
    if (rawInput) {
      let messages: any[];
      if (typeof rawInput === 'string') {
        messages = [formatInputMessage('user', rawInput)];
      } else if (Array.isArray(rawInput)) {
        messages = [];
        for (const item of rawInput.slice(0, 20)) {
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            if (item.role) {
              messages.push(item);
            } else {
              messages.push(formatInputMessage('user', item));
            }
          } else {
            const role = String(item?.role ?? 'user');
            const content = item?.content ?? String(item);
            messages.push(formatInputMessage(role, content));
          }
        }
      } else {
        messages = [formatInputMessage('user', rawInput)];
      }
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, JSON.stringify(messages));
    }

    const outputItems = response.output;
    if (Array.isArray(outputItems)) {
      const outMessages: any[] = [];
      for (const item of outputItems.slice(0, 20)) {
        const itemType = item.type;
        if (itemType === 'message') {
          const contentParts = item.content ?? [];
          const textParts: string[] = [];
          for (const part of contentParts) {
            const text = part.text;
            if (text) textParts.push(String(text));
          }
          if (textParts.length > 0) {
            outMessages.push(formatOutputMessage(textParts.join(' ')));
          }
        } else if (itemType === 'function_call') {
          outMessages.push({
            role: 'assistant',
            parts: [
              {
                type: 'tool_call',
                name: item.name ?? 'unknown',
                arguments: item.arguments ?? '',
              },
            ],
          });
        }
      }
      if (outMessages.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(outMessages));
      }
    }
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Generation (chat -- Chat Completions API)
// ---------------------------------------------------------------------------
function setGenerationAttributes(span: OtelSpan, spanData: any, captureContent: boolean): void {
  try {
    const model = spanData.model;
    if (model) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, String(model));
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, String(model));
    }

    const usage = spanData.usage;
    if (usage && typeof usage === 'object') {
      const inputTokens = usage.input_tokens ?? usage.inputTokens;
      const outputTokens = usage.output_tokens ?? usage.outputTokens;
      if (inputTokens != null) {
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
      }
      if (outputTokens != null) {
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
      }
    }

    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
    span.setAttribute(SemanticConvention.SERVER_PORT, OPENAI_SERVER_PORT);

    if (captureContent) {
      const rawInput = spanData.input;
      if (rawInput) {
        if (Array.isArray(rawInput)) {
          const messages = rawInput.slice(0, 20).map((msg: any) =>
            typeof msg === 'object' && msg !== null ? msg : formatInputMessage('user', msg),
          );
          span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, JSON.stringify(messages));
        } else {
          span.setAttribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES,
            JSON.stringify([formatInputMessage('user', rawInput)]),
          );
        }
      }

      const rawOutput = spanData.output;
      if (rawOutput) {
        if (Array.isArray(rawOutput)) {
          const messages = rawOutput.slice(0, 20).map((msg: any) =>
            typeof msg === 'object' && msg !== null ? msg : formatOutputMessage(msg),
          );
          span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(messages));
        } else {
          span.setAttribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
            JSON.stringify([formatOutputMessage(rawOutput)]),
          );
        }
      }
    }
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Function / Tool (execute_tool)
// ---------------------------------------------------------------------------
function setFunctionAttributes(span: OtelSpan, spanData: any, captureContent: boolean): void {
  try {
    const name = spanData.name;
    if (name) {
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, String(name));
    }
    span.setAttribute(SemanticConvention.GEN_AI_TOOL_TYPE, 'function');

    if (captureContent) {
      const toolInput = spanData.input;
      if (toolInput != null) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, String(toolInput));
      }
      const toolOutput = spanData.output;
      if (toolOutput != null) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_RESULT, String(toolOutput));
      }
    }
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Handoff (invoke_agent for target)
// ---------------------------------------------------------------------------
function setHandoffAttributes(
  span: OtelSpan,
  spanData: any,
  handoffTracker: Map<string, string>,
  traceId: string,
): void {
  try {
    const toAgent = spanData.toAgent ?? spanData.to_agent;
    const fromAgent = spanData.fromAgent ?? spanData.from_agent;

    if (toAgent) {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, String(toAgent));
      const key = `${toAgent}:${traceId}`;
      handoffTracker.set(key, fromAgent ? String(fromAgent) : 'unknown');
      if (handoffTracker.size > MAX_HANDOFFS) {
        const firstKey = handoffTracker.keys().next().value;
        if (firstKey !== undefined) handoffTracker.delete(firstKey);
      }
    }

    if (fromAgent) {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_SOURCE, String(fromAgent));
    }
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Guardrail (invoke_agent)
// ---------------------------------------------------------------------------
function setGuardrailAttributes(span: OtelSpan, spanData: any): void {
  try {
    const name = spanData.name;
    if (name) {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, String(name));
    }
    const triggered = spanData.triggered;
    if (triggered != null) {
      span.setAttribute('gen_ai.guardrail.triggered', Boolean(triggered));
    }
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Transcription (chat)
// ---------------------------------------------------------------------------
function setTranscriptionAttributes(span: OtelSpan, spanData: any, captureContent: boolean): void {
  try {
    const model = spanData.model;
    if (model) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, String(model));
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, String(model));
    }
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
    span.setAttribute(SemanticConvention.SERVER_PORT, OPENAI_SERVER_PORT);

    if (captureContent) {
      const output = spanData.output;
      if (output) {
        span.setAttribute(
          SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
          JSON.stringify([formatOutputMessage(output)]),
        );
      }
    }
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Speech (chat)
// ---------------------------------------------------------------------------
function setSpeechAttributes(span: OtelSpan, spanData: any, captureContent: boolean): void {
  try {
    const model = spanData.model;
    if (model) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, String(model));
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, String(model));
    }
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, 'speech');
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, OPENAI_SERVER_ADDRESS);
    span.setAttribute(SemanticConvention.SERVER_PORT, OPENAI_SERVER_PORT);

    if (captureContent) {
      const textInput = spanData.input;
      if (textInput) {
        span.setAttribute(
          SemanticConvention.GEN_AI_INPUT_MESSAGES,
          JSON.stringify([formatInputMessage('user', textInput)]),
        );
      }
    }
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// MCP List Tools (execute_tool)
// ---------------------------------------------------------------------------
function setMcpToolsAttributes(span: OtelSpan, spanData: any): void {
  try {
    span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, 'mcp_list_tools');
    span.setAttribute(SemanticConvention.GEN_AI_TOOL_TYPE, 'function');

    const server = spanData.server;
    if (server) {
      span.setAttribute('gen_ai.mcp.server', String(server));
    }

    const result = spanData.result;
    if (result) {
      const items = Array.isArray(result) ? result.slice(0, 50) : result;
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_RESULT, JSON.stringify(items));
    }
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Custom (invoke_agent)
// ---------------------------------------------------------------------------
function setCustomAttributes(span: OtelSpan, spanData: any): void {
  try {
    const name = spanData.name;
    if (name) {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, String(name));
    }
    const data = spanData.data;
    if (data && typeof data === 'object') {
      try {
        span.setAttribute('gen_ai.custom.data', JSON.stringify(data));
      } catch {
        // non-serialisable data
      }
    }
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
export function recordMetrics(
  operationType: string,
  durationSeconds: number,
  requestModel: string | null,
): void {
  try {
    const attributes: Record<string, string | number> = {
      [SemanticConvention.GEN_AI_OPERATION]: operationType,
      [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
      [ATTR_SERVICE_NAME]: OpenlitConfig.applicationName ?? 'default',
      [SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]: OpenlitConfig.environment ?? 'default',
    };
    if (requestModel) {
      attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = requestModel;
    }
    if (OPENAI_SERVER_ADDRESS) {
      attributes[SemanticConvention.SERVER_ADDRESS] = OPENAI_SERVER_ADDRESS;
    }
    if (OPENAI_SERVER_PORT) {
      attributes[SemanticConvention.SERVER_PORT] = OPENAI_SERVER_PORT;
    }

    Metrics.genaiClientOperationDuration?.record(durationSeconds, attributes);
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function extractModelFromSpanData(spanData: any): string | null {
  const model = spanData?.model;
  if (model) return String(model);

  const response = spanData?.response;
  if (response) {
    const rModel = response.model;
    if (rModel) return String(rModel);
  }

  return null;
}

function mapOutputType(outputType: any): string {
  if (outputType == null) return SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT;
  const s = String(outputType).toLowerCase();
  if (s.includes('dict') || s.includes('json')) return SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
  return SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT;
}

function formatInputMessage(role: string, content: any): Record<string, any> {
  return { role, parts: [{ type: 'text', content: String(content) }] };
}

function formatOutputMessage(content: any): Record<string, any> {
  return {
    role: 'assistant',
    parts: [{ type: 'text', content: String(content) }],
  };
}
