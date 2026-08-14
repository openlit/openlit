import {
  trace,
  Span,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import { AsyncLocalStorage } from 'async_hooks';
import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import { SDK_NAME, SDK_VERSION } from '../../constant';
import { applyCustomSpanAttributes, getServerAddressForProvider } from '../../helpers';

/**
 * Prevents Runner.run_async from creating a second invoke_agent span
 * when called internally by Runner.run (mirrors Python _ADK_WORKFLOW_ACTIVE).
 */
export const adkWorkflowActive = new AsyncLocalStorage<boolean>();

export function isAdkWorkflowActive(): boolean {
  return adkWorkflowActive.getStore() === true;
}

// ---------------------------------------------------------------------------
// OTel GenAI operation mapping (mirrors Python OPERATION_MAP)
// ---------------------------------------------------------------------------

export const OPERATION_MAP: Record<string, string> = {
  agent_init: SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
  runner_run_async: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  runner_run: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  runner_run_live: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  agent_run_async: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
};

const SPAN_KIND_MAP: Record<string, SpanKind> = {
  [SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT]: SpanKind.CLIENT,
  [SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK]: SpanKind.INTERNAL,
  [SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT]: SpanKind.INTERNAL,
  [SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS]: SpanKind.INTERNAL,
  [SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT]: SpanKind.CLIENT,
};

export function getOperationType(endpoint: string): string {
  return OPERATION_MAP[endpoint] ?? SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT;
}

export function getSpanKind(operationType: string): SpanKind {
  return SPAN_KIND_MAP[operationType] ?? SpanKind.INTERNAL;
}

// ---------------------------------------------------------------------------
// Span name generation (mirrors Python generate_span_name)
// ---------------------------------------------------------------------------

export function generateSpanName(endpoint: string, instance: any): string {
  if (endpoint === 'agent_init') {
    const name = instance?.name ?? 'agent';
    return `create_agent ${name}`;
  }
  if (endpoint === 'runner_run_async' || endpoint === 'runner_run' || endpoint === 'runner_run_live') {
    const appName = instance?.app_name ?? instance?._app_name ?? 'google_adk';
    return `invoke_agent ${appName}`;
  }
  if (endpoint === 'agent_run_async') {
    const name = instance?.name ?? 'agent';
    return `invoke_agent ${name}`;
  }
  return `${getOperationType(endpoint)} ${endpoint}`;
}

// ---------------------------------------------------------------------------
// PassthroughTracer (mirrors Python _PassthroughTracer)
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for ADK's tracer objects. Overrides
 * `startActiveSpan` to yield the current span instead of creating a new one,
 * letting OpenLIT own top-level spans while ADK's code still runs.
 */
export class PassthroughTracer {
  private _wrapped: any;

  constructor(wrapped: any) {
    this._wrapped = wrapped;
  }

  startActiveSpan(...args: any[]): any {
    const fn = args[args.length - 1];
    if (typeof fn === 'function') {
      const currentSpan = trace.getActiveSpan();
      return fn(currentSpan);
    }
    return undefined;
  }

  startSpan(...args: any[]): any {
    return this._wrapped.startSpan(...args);
  }
}

// ---------------------------------------------------------------------------
// Model extraction (mirrors Python _resolve_model_string / extract_model_name)
// ---------------------------------------------------------------------------

export function resolveModelString(modelObj: any): string | null {
  if (typeof modelObj === 'string') return modelObj;
  if (!modelObj) return null;
  const modelName = modelObj.model_name ?? modelObj.modelName;
  if (typeof modelName === 'string') return modelName;
  const inner = modelObj.model;
  if (typeof inner === 'string') return inner;
  return null;
}

export function extractModelName(instance: any): string {
  try {
    const model = instance?.model;
    if (model) {
      const resolved = resolveModelString(model);
      if (resolved) return resolved;
    }
    const rootAgent = instance?.agent;
    if (rootAgent) return extractModelName(rootAgent);
  } catch { /* ignore */ }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Server address resolution (mirrors Python resolve_server_info)
// ---------------------------------------------------------------------------

const PREFIX_TO_PROVIDER: Record<string, string> = {
  anthropic: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  gpt: 'openai',
  mistral: 'mistral_ai',
  cohere: 'cohere',
};

function detectProviderFromModelStr(modelStr: string): [string, number, string] | null {
  if (!modelStr) return null;
  const lower = modelStr.toLowerCase();
  const prefix = lower.includes('/') ? lower.split('/')[0] : lower.split('-')[0];
  const providerKey = PREFIX_TO_PROVIDER[prefix];
  if (!providerKey) return null;
  const [addr, port] = getServerAddressForProvider(providerKey);
  if (!addr) return null;
  return [addr, port, providerKey];
}

export function resolveServerInfo(
  instance?: any,
  modelName?: string | null
): [string, number, string] {
  if (modelName) {
    const detected = detectProviderFromModelStr(modelName);
    if (detected) return detected;
  }

  if (instance) {
    try {
      let modelObj = instance.model;
      if (!modelObj) {
        const agent = instance.agent;
        if (agent) modelObj = agent.model;
      }
      if (modelObj) {
        const resolved = resolveModelString(modelObj);
        if (resolved) {
          const detected = detectProviderFromModelStr(resolved);
          if (detected) return detected;
        }
      }
    } catch { /* ignore */ }
  }

  const useVertex = (process.env.GOOGLE_GENAI_USE_VERTEXAI || '').toLowerCase();
  if (useVertex === 'true' || useVertex === '1') {
    const [addr, port] = getServerAddressForProvider('gcp.vertex_ai');
    return [addr, port, 'gcp.vertex_ai'];
  }
  const [addr, port] = getServerAddressForProvider('gcp.gemini');
  return [addr, port, 'gcp.gemini'];
}

// ---------------------------------------------------------------------------
// Common span attributes (mirrors Python common_framework_span_attributes)
// ---------------------------------------------------------------------------

export function setCommonSpanAttributes(
  span: Span,
  operationType: string,
): void {
  span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
  span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment || 'default');
  span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName || 'default');
  span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
  span.setAttribute(SemanticConvention.GEN_AI_OPERATION, operationType);
  span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK);
}

// ---------------------------------------------------------------------------
// Content extraction helpers (mirrors Python _extract_parts)
// ---------------------------------------------------------------------------

function truncateContent(str: string, maxLen?: number | null): string {
  const limit = maxLen ?? OpenlitConfig.maxContentLength;
  if (limit && str.length > limit) return str.slice(0, limit) + '...';
  return str;
}

interface ExtractedParts {
  textParts: string[];
  toolCalls: { name: string; id: string; arguments?: string }[];
  toolResponses: { name: string; id: string; content?: string }[];
}

function extractParts(parts: any[] | null | undefined): ExtractedParts {
  const textParts: string[] = [];
  const toolCalls: { name: string; id: string; arguments?: string }[] = [];
  const toolResponses: { name: string; id: string; content?: string }[] = [];

  for (const part of parts || []) {
    const text = part?.text;
    if (text) textParts.push(truncateContent(String(text)));

    const fc = part?.function_call ?? part?.functionCall;
    if (fc) {
      const entry: { name: string; id: string; arguments?: string } = {
        name: fc.name ?? '',
        id: fc.id ?? '',
      };
      const fcArgs = fc.args;
      if (fcArgs) {
        try {
          entry.arguments = typeof fcArgs === 'object' ? JSON.stringify(fcArgs) : String(fcArgs);
        } catch { entry.arguments = String(fcArgs); }
      }
      toolCalls.push(entry);
    }

    const fr = part?.function_response ?? part?.functionResponse;
    if (fr) {
      const respEntry: { name: string; id: string; content?: string } = {
        name: fr.name ?? '',
        id: fr.id ?? '',
      };
      const frResp = fr.response;
      if (frResp != null) {
        try {
          respEntry.content = typeof frResp === 'object' ? JSON.stringify(frResp) : String(frResp);
        } catch { respEntry.content = String(frResp); }
      }
      toolResponses.push(respEntry);
    }
  }

  return { textParts, toolCalls, toolResponses };
}

// ---------------------------------------------------------------------------
// Input/Output message capture (mirrors Python capture_input_messages / capture_output_messages)
// ---------------------------------------------------------------------------

export function captureInputMessages(span: Span, llmRequest: any, captureContent: boolean): void {
  if (!captureContent) return;
  try {
    const contents = llmRequest?.contents;
    if (!contents) return;
    const messages: any[] = [];
    for (const content of (contents as any[]).slice(0, 20)) {
      const role = content?.role ?? 'user';
      const rawParts = content?.parts ?? [];
      const { textParts, toolCalls, toolResponses } = extractParts(rawParts);

      const parts: any[] = [];
      for (const text of textParts) parts.push({ type: 'text', content: text });
      for (const tc of toolCalls) {
        parts.push({ type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments ?? '' });
      }
      for (const tr of toolResponses) {
        parts.push({ type: 'tool_call_response', id: tr.id, response: tr.content ?? '' });
      }
      if (parts.length > 0) messages.push({ role: String(role), parts });
    }
    if (messages.length > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, JSON.stringify(messages));
    }
  } catch { /* ignore */ }
}

export function captureOutputMessages(
  span: Span,
  llmResponse: any,
  captureContent: boolean,
  finishReason = 'stop',
): void {
  if (!captureContent) return;
  try {
    const content = llmResponse?.content;
    if (!content) return;
    const rawParts = content.parts ?? [];
    const { textParts, toolCalls } = extractParts(rawParts);

    const parts: any[] = [];
    for (const text of textParts) parts.push({ type: 'text', content: text });
    for (const tc of toolCalls) {
      parts.push({ type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments ?? '' });
    }
    if (parts.length > 0) {
      const messages = [{ role: 'assistant', parts, finish_reason: finishReason }];
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(messages));
    }
  } catch { /* ignore */ }
}

export function captureEventOutput(span: Span, event: any, captureContent: boolean): void {
  if (!captureContent) return;
  try {
    const content = event?.content;
    if (!content) return;
    const rawParts = content.parts ?? [];
    const { textParts, toolCalls } = extractParts(rawParts);

    const parts: any[] = [];
    for (const text of textParts) parts.push({ type: 'text', content: text });
    for (const tc of toolCalls) {
      parts.push({ type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments ?? '' });
    }
    if (parts.length > 0) {
      const messages = [{ role: 'assistant', parts, finish_reason: 'stop' }];
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(messages));
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Token extraction (mirrors Python extract_token_usage)
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
}

export function extractTokenUsage(llmResponse: any): TokenUsage {
  try {
    const usage = llmResponse?.usage_metadata ?? llmResponse?.usageMetadata;
    if (!usage) return {};
    return {
      inputTokens: usage.prompt_token_count ?? usage.promptTokenCount,
      outputTokens: usage.candidates_token_count ?? usage.candidatesTokenCount,
      reasoningTokens: usage.thoughts_token_count ?? usage.thoughtsTokenCount,
      cachedTokens: usage.cached_content_token_count ?? usage.cachedContentTokenCount,
      totalTokens: usage.total_token_count ?? usage.totalTokenCount,
    };
  } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Output type detection (mirrors Python _determine_output_type)
// ---------------------------------------------------------------------------

function determineOutputType(llmResponse: any): string {
  try {
    const content = llmResponse?.content;
    if (content) {
      for (const part of (content.parts ?? [])) {
        if (part?.function_call || part?.functionCall) return 'tool_calls';
      }
    }
  } catch { /* ignore */ }
  return 'text';
}

// ---------------------------------------------------------------------------
// LLM span enrichment (mirrors Python enrich_llm_span)
// ---------------------------------------------------------------------------

export function enrichLlmSpan(
  span: Span,
  llmRequest: any,
  llmResponse: any,
  captureMessageContent: boolean,
): void {
  try {
    const requestModel = llmRequest?.model;
    const modelStr = requestModel ? String(requestModel) : null;
    const [serverAddress, serverPort, providerName] = resolveServerInfo(undefined, modelStr);

    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
    span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, providerName);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, serverAddress);
    span.setAttribute(SemanticConvention.SERVER_PORT, serverPort);

    if (llmRequest) {
      if (modelStr) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, modelStr);

      const config = llmRequest.config;
      if (config) {
        const temp = config.temperature;
        if (temp != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, Number(temp));
        const topP = config.top_p ?? config.topP;
        if (topP != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, Number(topP));
        const maxTokens = config.max_output_tokens ?? config.maxOutputTokens;
        if (maxTokens != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, Number(maxTokens));
      }

      if (captureMessageContent) {
        const sysInstr = config?.system_instruction ?? config?.systemInstruction;
        if (sysInstr) {
          const instrText = typeof sysInstr === 'string' ? sysInstr : String(sysInstr);
          span.setAttribute(
            SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
            JSON.stringify([{ type: 'text', content: truncateContent(instrText) }])
          );
        }
      }
      captureInputMessages(span, llmRequest, captureMessageContent);
    }

    if (llmResponse) {
      const { inputTokens, outputTokens, reasoningTokens, cachedTokens, totalTokens } = extractTokenUsage(llmResponse);
      if (inputTokens != null) span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
      if (outputTokens != null) span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
      if (reasoningTokens != null) span.setAttribute(SemanticConvention.GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_REASONING, reasoningTokens);
      if (cachedTokens != null) span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cachedTokens);
      if (totalTokens != null) span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);

      const responseModel = llmResponse.model_version ?? llmResponse.modelVersion;
      if (responseModel) span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, String(responseModel));

      let frStr = 'stop';
      const finishReason = llmResponse.finish_reason ?? llmResponse.finishReason;
      if (finishReason) {
        try {
          frStr = (typeof finishReason === 'object' && finishReason.value)
            ? String(finishReason.value).toLowerCase()
            : String(finishReason).toLowerCase();
        } catch { frStr = String(finishReason).toLowerCase(); }
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [frStr]);
      }

      const responseId = llmResponse.response_id ?? llmResponse.responseId ?? llmResponse.id;
      if (responseId) span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, String(responseId));

      const errorCode = llmResponse.error_code ?? llmResponse.errorCode;
      if (errorCode) {
        span.setAttribute(SemanticConvention.ERROR_TYPE, String(errorCode));
        const errorMessage = llmResponse.error_message ?? llmResponse.errorMessage;
        if (errorMessage) span.setStatus({ code: SpanStatusCode.ERROR, message: String(errorMessage) });
      }

      captureOutputMessages(span, llmResponse, captureMessageContent, frStr);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, determineOutputType(llmResponse));
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// ADK Event extraction (mirrors Python _extract_from_event / _is_adk_event)
// ---------------------------------------------------------------------------

function isAdkEvent(obj: any): boolean {
  if (!obj) return false;
  return (obj.constructor?.name === 'Event') && ('content' in obj);
}

function extractFromEvent(eventObj: any): [any | null, string | null] {
  try {
    const content = eventObj?.content;
    if (!content) return [null, null];
    const parts = content.parts;
    if (!parts || parts.length === 0) return [null, null];
    const fnResp = parts[0]?.function_response ?? parts[0]?.functionResponse;
    if (!fnResp) return [null, null];
    return [fnResp.response ?? null, fnResp.id ?? null];
  } catch { return [null, null]; }
}

// ---------------------------------------------------------------------------
// Tool type mapping (mirrors Python _otel_gen_ai_tool_type)
// ---------------------------------------------------------------------------

function otelToolType(tool: any): string {
  const name = tool?.constructor?.name ?? '';
  if (name.includes('Function')) return 'function';
  if (name.includes('Agent')) return 'extension';
  return 'function';
}

// ---------------------------------------------------------------------------
// Tool span enrichment (mirrors Python enrich_tool_span)
// ---------------------------------------------------------------------------

export function enrichToolSpan(
  span: Span,
  tool: any,
  functionArgs: any,
  functionResponseEvent: any,
  captureMessageContent: boolean,
  error?: any,
): void {
  try {
    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS);
    span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK);

    if (tool) {
      const toolName = tool.name ?? tool.constructor?.name ?? 'unknown';
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, String(toolName));
      span.setAttribute(SemanticConvention.GEN_AI_TOOL_TYPE, otelToolType(tool));
      const toolDesc = tool.description;
      if (toolDesc) span.setAttribute(SemanticConvention.GEN_AI_TOOL_DESCRIPTION, truncateContent(String(toolDesc)));
    }

    let responseDict: any = null;
    let toolCallId: string | null = null;
    if (isAdkEvent(functionResponseEvent)) {
      [responseDict, toolCallId] = extractFromEvent(functionResponseEvent);
    } else if (typeof functionResponseEvent === 'object' && functionResponseEvent !== null) {
      responseDict = functionResponseEvent;
      toolCallId = functionResponseEvent.id ?? null;
    }

    if (captureMessageContent) {
      if (functionArgs != null) {
        try {
          const argsStr = typeof functionArgs === 'object' ? JSON.stringify(functionArgs) : String(functionArgs);
          span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, truncateContent(argsStr));
        } catch { span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, truncateContent(String(functionArgs))); }
      }
      if (responseDict != null) {
        try {
          const resultStr = typeof responseDict === 'object' ? JSON.stringify(responseDict) : String(responseDict);
          span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_RESULT, truncateContent(resultStr));
        } catch { span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_RESULT, truncateContent(String(responseDict))); }
      }
    }

    if (toolCallId) span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, String(toolCallId));

    if (error != null) {
      const errorType = error.constructor?.name || '_OTHER';
      span.setAttribute(SemanticConvention.ERROR_TYPE, errorType);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Merged tool span enrichment (mirrors Python enrich_merged_tool_span)
// ---------------------------------------------------------------------------

export function enrichMergedToolSpan(
  span: Span,
  responseEventId: any,
  functionResponseEvent: any,
  captureMessageContent: boolean,
): void {
  try {
    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS);
    span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK);
    span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, '(merged tools)');

    if (responseEventId) span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, String(responseEventId));

    if (captureMessageContent && functionResponseEvent != null) {
      try {
        const content = functionResponseEvent.content;
        if (content) {
          const parts = content.parts ?? [];
          const toolResults: any[] = [];
          for (const part of parts) {
            const fnResp = part?.function_response ?? part?.functionResponse;
            if (fnResp) {
              const entry: any = {};
              const name = fnResp.name;
              if (name) entry.name = String(name);
              const resp = fnResp.response;
              if (resp != null) entry.response = resp;
              if (Object.keys(entry).length > 0) toolResults.push(entry);
            }
          }
          if (toolResults.length > 0) {
            span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_RESULT, truncateContent(JSON.stringify(toolResults)));
          }
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Runner/Agent attribute setters (mirrors Python _set_runner_agent_attributes / _set_agent_attributes)
// ---------------------------------------------------------------------------

export function setRunnerAgentAttributes(span: Span, instance: any, endpoint: string): void {
  try {
    const appName = instance?.app_name ?? instance?._app_name ?? 'google_adk';
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, String(appName));

    if (endpoint === 'runner_run_live') {
      span.setAttribute(SemanticConvention.GEN_AI_EXECUTION_MODE, 'live');
    } else if (endpoint === 'runner_run') {
      span.setAttribute(SemanticConvention.GEN_AI_EXECUTION_MODE, 'sync');
    } else {
      span.setAttribute(SemanticConvention.GEN_AI_EXECUTION_MODE, 'async');
    }
  } catch { /* ignore */ }
}

export function setAgentAttributes(span: Span, instance: any): void {
  try {
    const name = instance?.name;
    if (name) span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, String(name));
    const description = instance?.description;
    if (description) span.setAttribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, String(description));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Response processing for Runner/Agent spans (mirrors Python process_google_adk_response)
// ---------------------------------------------------------------------------

export function processGoogleAdkResponse(
  span: Span,
  endpoint: string,
  instance: any,
  startTime: number,
  _captureMessageContent: boolean,
): void {
  const endTime = Date.now();
  const operationType = getOperationType(endpoint);
  const [serverAddress, serverPort] = resolveServerInfo(instance);
  const requestModel = extractModelName(instance);

  setCommonSpanAttributes(span, operationType);

  if (requestModel && requestModel !== 'unknown') {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, requestModel);
  }
  if (serverAddress) span.setAttribute(SemanticConvention.SERVER_ADDRESS, serverAddress);
  if (serverPort) span.setAttribute(SemanticConvention.SERVER_PORT, serverPort);

  if (endpoint === 'runner_run_async' || endpoint === 'runner_run' || endpoint === 'runner_run_live') {
    setRunnerAgentAttributes(span, instance, endpoint);
  } else if (endpoint === 'agent_run_async') {
    setAgentAttributes(span, instance);
  }

  span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
  span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, (endTime - startTime) / 1000);
  applyCustomSpanAttributes(span);
  span.setStatus({ code: SpanStatusCode.OK });
}

// ---------------------------------------------------------------------------
// Metrics recording (mirrors Python record_google_adk_metrics)
// ---------------------------------------------------------------------------

export function recordGoogleAdkMetrics(
  operationType: string,
  duration: number,
  requestModel: string,
  serverAddress: string,
  serverPort: number,
): void {
  try {
    const Metrics = require('../../otel/metrics').default;
    const attributes: Record<string, any> = {
      [ATTR_TELEMETRY_SDK_NAME]: SDK_NAME,
      [ATTR_SERVICE_NAME]: OpenlitConfig.applicationName || 'default',
      [SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]: OpenlitConfig.environment || 'default',
      [SemanticConvention.GEN_AI_OPERATION]: operationType,
      [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK,
    };
    if (requestModel && requestModel !== 'unknown') {
      attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = requestModel;
    }
    if (serverAddress) attributes[SemanticConvention.SERVER_ADDRESS] = serverAddress;
    if (serverPort) attributes[SemanticConvention.SERVER_PORT] = serverPort;

    if (Metrics.genaiClientOperationDuration) {
      Metrics.genaiClientOperationDuration.record(duration, attributes);
    }
  } catch { /* ignore */ }
}
