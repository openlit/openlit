/**
 * Mastra SpanProcessor.
 *
 * Enriches Mastra's native OTel spans (via @mastra/otel-bridge) with
 * OpenLIT-specific attributes, extracts content from span
 * attributes/events, emits gen_ai.client.inference.operation.details
 * log events for chat-equivalent spans, and records OpenLIT metrics.
 *
 * Provider-level chat spans (OpenAI, Anthropic, etc.) are suppressed
 * when they occur inside a Mastra agent.generate / agent.stream span
 * via the shared _frameworkLlmActive AsyncLocalStorage flag.
 *
 * Mirrors the Python Strands SpanProcessor:
 *   sdk/python/src/openlit/instrumentation/strands/processor.py
 */

import {
  Context,
  Span as ApiSpan,
} from '@opentelemetry/api';
import { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_TELEMETRY_SDK_NAME,
} from '@opentelemetry/semantic-conventions';

import SemanticConvention from '../../semantic-convention';
import { SDK_VERSION } from '../../constant';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  applyCustomSpanAttributes,
  setFrameworkLlmActive,
  resetFrameworkLlmActive,
} from '../../helpers';
import {
  isMastraSpanByName,
  getOperationFromSpanName,
  isLlmEncompassingSpan,
  inferServerAddress,
  inferProviderName,
  extractAgentName,
  extractContentFromAttributes,
  extractContentFromEvents,
  truncateContent,
  recordMastraMetrics,
  emitMastraInferenceEvent,
  MastraSpanAttrs,
} from './utils';

export class MastraSpanProcessor implements SpanProcessor {
  /**
   * Tracks span IDs that set the frameworkLlmActive flag, so we
   * can reset it in on_end (mirrors Python _fw_tokens dict).
   */
  private _fwTokens = new Set<string>();

  /**
   * Stores enriched chat span data keyed by parent span ID, so
   * invoke_agent spans can inherit response info from child chat spans.
   */
  private _chatInfo = new Map<string, ChatInfo>();

  // -----------------------------------------------------------------
  // Span detection
  // -----------------------------------------------------------------

  private _isMastraSpan(span: any): boolean {
    const name: string = span.name || '';
    if (isMastraSpanByName(name)) return true;

    const scope = span.instrumentationLibrary || span.instrumentationScope;
    if (
      scope?.name &&
      (scope.name.includes('mastra') || scope.name.includes('@mastra/'))
    ) {
      return true;
    }

    const attrs = span.attributes || {};
    const system =
      attrs['gen_ai.system'] ||
      attrs[SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL];
    return system === SemanticConvention.GEN_AI_SYSTEM_MASTRA;
  }

  // -----------------------------------------------------------------
  // Attribute mutation helpers (span is read-only after on_end)
  // -----------------------------------------------------------------

  private _setAttr(span: any, key: string, value: any): void {
    try {
      if (span.attributes) {
        span.attributes[key] = value;
      }
    } catch {
      // ignore
    }
  }

  private _setAttrs(span: any, mapping: Record<string, any>): void {
    try {
      if (span.attributes) {
        Object.assign(span.attributes, mapping);
      }
    } catch {
      // ignore
    }
  }

  // -----------------------------------------------------------------
  // SpanProcessor API
  // -----------------------------------------------------------------

  onStart(span: ApiSpan, _parentContext: Context): void {
    if (!this._isMastraSpan(span)) return;

    try {
      span.setAttribute(ATTR_TELEMETRY_SDK_NAME, 'openlit');
      span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
      span.setAttribute(
        SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT,
        OpenlitConfig.environment || 'default'
      );
      span.setAttribute(
        ATTR_SERVICE_NAME,
        OpenlitConfig.applicationName || 'default'
      );
      applyCustomSpanAttributes(span);
    } catch {
      // ignore
    }

    const spanName: string = (span as any).name || '';
    if (isLlmEncompassingSpan(spanName)) {
      try {
        setFrameworkLlmActive();
        const spanId = (span as any).spanContext?.()?.spanId;
        if (spanId) {
          this._fwTokens.add(spanId);
        }
      } catch {
        // ignore
      }
    }
  }

  onEnd(span: ReadableSpan): void {
    if (!this._isMastraSpan(span)) return;

    const spanId = span.spanContext().spanId;
    if (this._fwTokens.has(spanId)) {
      this._fwTokens.delete(spanId);
      try {
        resetFrameworkLlmActive();
      } catch {
        // ignore
      }
    }

    try {
      this._processSpan(span);
    } catch {
      // ignore
    }
  }

  async shutdown(): Promise<void> {
    // no-op
  }

  async forceFlush(): Promise<void> {
    // no-op
  }

  // -----------------------------------------------------------------
  // Core processing
  // -----------------------------------------------------------------

  private _processSpan(span: ReadableSpan): void {
    const attrs: Record<string, any> = (span.attributes as any) || {};
    const spanName: string = (span as any).name || '';
    const operation = getOperationFromSpanName(spanName);

    if (!operation) return;

    // Set operation name attribute
    this._setAttr(span, SemanticConvention.GEN_AI_OPERATION, operation);

    // Ensure gen_ai.provider.name is set
    const existingSystem =
      attrs['gen_ai.system'] ||
      attrs[SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL];
    if (!existingSystem) {
      this._setAttr(
        span,
        SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL,
        SemanticConvention.GEN_AI_SYSTEM_MASTRA
      );
    }

    // Agent name from Mastra entityName attribute
    const agentName = extractAgentName(attrs);
    if (agentName && !attrs[SemanticConvention.GEN_AI_AGENT_NAME]) {
      this._setAttr(span, SemanticConvention.GEN_AI_AGENT_NAME, agentName);
    }

    // Agent ID generation (same pattern as Python Strands)
    if (agentName && !attrs[SemanticConvention.GEN_AI_AGENT_ID]) {
      const spanIdHex = span.spanContext().spanId;
      this._setAttr(
        span,
        SemanticConvention.GEN_AI_AGENT_ID,
        `${agentName}-${spanIdHex}`
      );
    }

    // Thread/conversation ID mapping
    const threadId = attrs[MastraSpanAttrs.THREAD_ID];
    if (threadId && !attrs[SemanticConvention.GEN_AI_CONVERSATION_ID]) {
      this._setAttr(
        span,
        SemanticConvention.GEN_AI_CONVERSATION_ID,
        String(threadId)
      );
    }

    // Duration (nanoseconds → seconds)
    let duration = 0;
    if (span.endTime && span.startTime) {
      const [endSec, endNano] = span.endTime;
      const [startSec, startNano] = span.startTime;
      duration = endSec - startSec + (endNano - startNano) / 1e9;
    }
    this._setAttr(
      span,
      SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
      duration
    );

    // Server address / port inference from model name
    const modelName = String(
      attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] || ''
    );
    let serverAddress = String(attrs[SemanticConvention.SERVER_ADDRESS] || '');
    let serverPort = Number(attrs[SemanticConvention.SERVER_PORT] || 0);
    if (!serverAddress && modelName) {
      [serverAddress, serverPort] = inferServerAddress(modelName);
      if (serverAddress) {
        this._setAttrs(span, {
          [SemanticConvention.SERVER_ADDRESS]: serverAddress,
          [SemanticConvention.SERVER_PORT]: serverPort,
        });
      }
    }

    // Operation-specific enrichment
    switch (operation) {
      case SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT:
        this._processAgentSpan(span, attrs);
        break;
      case SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK:
        this._processWorkflowSpan(span, attrs);
        break;
      case SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS:
        this._processToolSpan(span, attrs);
        break;
      case SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT:
        this._processChatSpan(span, attrs, modelName, serverAddress, serverPort);
        break;
      default:
        break;
    }

    // OTel-compliant span name: "{operation} {identifier}"
    this._setOtelSpanName(span, operation);

    // Content capture (gated by captureMessageContent)
    if (OpenlitConfig.captureMessageContent) {
      this._extractAndSetContent(span, operation, spanName);
    }

    // Emit inference log event for chat-equivalent spans
    if (
      operation === SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT &&
      !OpenlitConfig.disableEvents
    ) {
      this._emitChatInferenceEvent(span, serverAddress, serverPort);
    }

    // Record metrics
    if (!OpenlitConfig.disableMetrics && operation) {
      recordMastraMetrics(
        operation,
        duration,
        modelName,
        serverAddress,
        serverPort
      );
    }

    // Error type enrichment (low-cardinality per OTel spec)
    const status = (span as any).status;
    if (status && status.code === 2) {
      // StatusCode.ERROR = 2
      if (!attrs[SemanticConvention.ERROR_TYPE]) {
        this._setAttr(
          span,
          SemanticConvention.ERROR_TYPE,
          '_OTHER'
        );
      }
    }
  }

  // -----------------------------------------------------------------
  // Operation-specific processing
  // -----------------------------------------------------------------

  private _processAgentSpan(
    span: ReadableSpan,
    attrs: Record<string, any>
  ): void {
    this._setAttr(
      span,
      SemanticConvention.GEN_AI_OUTPUT_TYPE,
      SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
    );
    this._enrichAgentFromChildren(span);
  }

  private _processWorkflowSpan(
    span: ReadableSpan,
    attrs: Record<string, any>
  ): void {
    const workflowName =
      attrs[SemanticConvention.GEN_AI_WORKFLOW_NAME] ||
      extractAgentName(attrs) ||
      '';
    if (workflowName && !attrs[SemanticConvention.GEN_AI_WORKFLOW_NAME]) {
      this._setAttr(
        span,
        SemanticConvention.GEN_AI_WORKFLOW_NAME,
        workflowName
      );
    }
  }

  private _processToolSpan(
    span: ReadableSpan,
    attrs: Record<string, any>
  ): void {
    if (!attrs[SemanticConvention.GEN_AI_TOOL_TYPE]) {
      this._setAttr(span, SemanticConvention.GEN_AI_TOOL_TYPE, 'function');
    }

    const spanName: string = (span as any).name || '';
    if (
      !attrs[SemanticConvention.GEN_AI_TOOL_NAME] &&
      spanName.startsWith('tool.')
    ) {
      const toolName = spanName.substring(5);
      if (toolName) {
        this._setAttr(span, SemanticConvention.GEN_AI_TOOL_NAME, toolName);
      }
    }

    // Extract tool call ID from attributes
    if (!attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID]) {
      const tid =
        attrs['tool_use_id'] ||
        attrs['toolUseId'] ||
        attrs['gen_ai.tool.call.id'];
      if (tid) {
        this._setAttr(span, SemanticConvention.GEN_AI_TOOL_CALL_ID, String(tid));
      }
    }
  }

  // -----------------------------------------------------------------
  // Chat span enrichment (parity with provider spans)
  // -----------------------------------------------------------------

  private _processChatSpan(
    span: ReadableSpan,
    attrs: Record<string, any>,
    modelName: string,
    serverAddress: string,
    serverPort: number
  ): void {
    const enrichments: Record<string, any> = {};

    const provider = modelName ? inferProviderName(modelName) : '';
    if (provider) {
      enrichments[SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL] = provider;
    }

    if (!attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] && modelName) {
      enrichments[SemanticConvention.GEN_AI_RESPONSE_MODEL] = modelName;
    }

    enrichments[SemanticConvention.GEN_AI_OUTPUT_TYPE] =
      SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT;

    // Token totals and cost
    const inputTokens = Number(attrs['gen_ai.usage.input_tokens'] || 0);
    const outputTokens = Number(attrs['gen_ai.usage.output_tokens'] || 0);
    if (inputTokens || outputTokens) {
      enrichments[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] =
        inputTokens + outputTokens;
    }
    if (OpenlitConfig.pricingInfo && modelName) {
      const cost = OpenLitHelper.getChatModelCost(
        modelName,
        OpenlitConfig.pricingInfo,
        inputTokens,
        outputTokens
      );
      if (cost > 0) {
        enrichments[SemanticConvention.GEN_AI_USAGE_COST] = cost;
      }
    }

    // Finish reasons from output events
    const [, outputMsgs] = extractContentFromEvents(span, 'chat');
    if (outputMsgs.length > 0) {
      const finishReasons = outputMsgs
        .filter((m: any) => typeof m === 'object' && m?.finish_reason)
        .map((m: any) => m.finish_reason);
      if (finishReasons.length > 0) {
        enrichments[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] =
          finishReasons;
      }
    }

    if (Object.keys(enrichments).length > 0) {
      this._setAttrs(span, enrichments);
    }

    this._storeChatInfoForParent(span, modelName);
  }

  private _storeChatInfoForParent(
    span: ReadableSpan,
    modelName: string
  ): void {
    try {
      const parentId = (span as any).parentSpanId;
      if (!parentId) return;
      const finalAttrs: Record<string, any> =
        (span.attributes as any) || {};
      this._chatInfo.set(parentId, {
        responseModel:
          finalAttrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] || modelName,
        responseId: finalAttrs[SemanticConvention.GEN_AI_RESPONSE_ID],
        finishReasons:
          finalAttrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON],
        inputTokens: finalAttrs['gen_ai.usage.input_tokens'] || 0,
        outputTokens: finalAttrs['gen_ai.usage.output_tokens'] || 0,
      });
    } catch {
      // ignore
    }
  }

  private _enrichAgentFromChildren(span: ReadableSpan): void {
    try {
      const spanId = span.spanContext().spanId;
      const info = this._chatInfo.get(spanId);
      if (!info) return;
      this._chatInfo.delete(spanId);

      const enrichments: Record<string, any> = {};
      const current: Record<string, any> = (span.attributes as any) || {};
      if (
        info.responseModel &&
        !current[SemanticConvention.GEN_AI_RESPONSE_MODEL]
      ) {
        enrichments[SemanticConvention.GEN_AI_RESPONSE_MODEL] =
          info.responseModel;
      }
      if (
        info.responseId &&
        !current[SemanticConvention.GEN_AI_RESPONSE_ID]
      ) {
        enrichments[SemanticConvention.GEN_AI_RESPONSE_ID] = info.responseId;
      }
      if (
        info.finishReasons &&
        !current[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]
      ) {
        enrichments[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] =
          info.finishReasons;
      }
      if (Object.keys(enrichments).length > 0) {
        this._setAttrs(span, enrichments);
      }
    } catch {
      // ignore
    }
  }

  // -----------------------------------------------------------------
  // OTel-compliant span names
  // -----------------------------------------------------------------

  private _setOtelSpanName(span: ReadableSpan, operation: string): void {
    try {
      const attrs: Record<string, any> = (span.attributes as any) || {};
      const spanAny = span as any;

      switch (operation) {
        case SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT: {
          const name = attrs[SemanticConvention.GEN_AI_AGENT_NAME];
          if (name) spanAny._name = `invoke_agent ${name}`;
          break;
        }
        case SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS: {
          const name = attrs[SemanticConvention.GEN_AI_TOOL_NAME];
          if (name) spanAny._name = `execute_tool ${name}`;
          break;
        }
        case SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK: {
          const name = attrs[SemanticConvention.GEN_AI_WORKFLOW_NAME];
          if (name) spanAny._name = `invoke_workflow ${name}`;
          break;
        }
        case SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT: {
          const model = attrs[SemanticConvention.GEN_AI_REQUEST_MODEL];
          if (model) spanAny._name = `chat ${model}`;
          break;
        }
        case SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT: {
          const name = attrs[SemanticConvention.GEN_AI_AGENT_NAME];
          if (name) spanAny._name = `create_agent ${name}`;
          break;
        }
      }
    } catch {
      // ignore
    }
  }

  // -----------------------------------------------------------------
  // Content extraction → span attributes
  // -----------------------------------------------------------------

  private _extractAndSetContent(
    span: ReadableSpan,
    operation: string,
    spanName: string
  ): void {
    try {
      const attrs: Record<string, any> = (span.attributes as any) || {};
      const [evtInput, evtOutput, evtSystem] = extractContentFromEvents(
        span,
        operation
      );
      const [attrInput, attrOutput, attrSystem] =
        extractContentFromAttributes(attrs, spanName);

      const inputMessages =
        evtInput.length > 0 ? evtInput : attrInput;
      const outputMessages =
        evtOutput.length > 0 ? evtOutput : attrOutput;
      const systemInstructions = evtSystem || attrSystem;

      const additions: Record<string, any> = {};

      if (operation === SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS) {
        if (inputMessages && inputMessages.length > 0) {
          const first = inputMessages[0];
          const parts = first?.parts || [];
          if (parts.length > 0) {
            const args =
              parts[0]?.arguments || parts[0]?.content || '';
            additions[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS] =
              truncateContent(
                typeof args === 'string' ? args : JSON.stringify(args)
              );
          }
        }
        if (outputMessages && outputMessages.length > 0) {
          additions[SemanticConvention.GEN_AI_TOOL_CALL_RESULT] =
            truncateContent(JSON.stringify(outputMessages));
        }
      } else {
        if (inputMessages && inputMessages.length > 0) {
          additions[SemanticConvention.GEN_AI_INPUT_MESSAGES] =
            JSON.stringify(inputMessages);
        }
        if (outputMessages && outputMessages.length > 0) {
          additions[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] =
            JSON.stringify(outputMessages);
        }
        if (systemInstructions) {
          additions[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] =
            truncateContent(systemInstructions);
        }
      }

      if (Object.keys(additions).length > 0) {
        this._setAttrs(span, additions);
      }
    } catch {
      // ignore
    }
  }

  // -----------------------------------------------------------------
  // Chat inference log event
  // -----------------------------------------------------------------

  private _emitChatInferenceEvent(
    span: ReadableSpan,
    serverAddress: string,
    serverPort: number
  ): void {
    try {
      const attrs: Record<string, any> = (span.attributes as any) || {};
      const spanName: string = (span as any).name || '';

      const [evtInput, evtOutput, evtSystem] = extractContentFromEvents(
        span,
        'chat'
      );
      const [attrInput, attrOutput, attrSystem] =
        extractContentFromAttributes(attrs, spanName);

      const inputMessages =
        evtInput.length > 0 ? evtInput : attrInput;
      const outputMessages =
        evtOutput.length > 0 ? evtOutput : attrOutput;
      const systemInstructions = evtSystem || attrSystem;

      const extra: Record<string, any> = {};
      const inputTokens = attrs['gen_ai.usage.input_tokens'];
      const outputTokens = attrs['gen_ai.usage.output_tokens'];
      if (inputTokens != null) extra.inputTokens = inputTokens;
      if (outputTokens != null) extra.outputTokens = outputTokens;

      const responseId = attrs[SemanticConvention.GEN_AI_RESPONSE_ID];
      if (responseId) extra.responseId = responseId;

      if (systemInstructions) extra.systemInstructions = systemInstructions;

      if (outputMessages && outputMessages.length > 0) {
        const finishReasons = outputMessages
          .filter((m: any) => typeof m === 'object' && m?.finish_reason)
          .map((m: any) => m.finish_reason);
        if (finishReasons.length > 0) extra.finishReasons = finishReasons;
      }

      if (inputMessages) extra.inputMessages = inputMessages;
      if (outputMessages) extra.outputMessages = outputMessages;

      emitMastraInferenceEvent(
        span,
        String(attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] || ''),
        serverAddress,
        serverPort,
        extra
      );
    } catch {
      // ignore
    }
  }
}

// -----------------------------------------------------------------
// Internal types
// -----------------------------------------------------------------

interface ChatInfo {
  responseModel: any;
  responseId: any;
  finishReasons: any;
  inputTokens: number;
  outputTokens: number;
}
