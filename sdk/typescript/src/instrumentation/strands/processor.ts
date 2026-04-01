/**
 * Strands Agents SpanProcessor.
 *
 * Enriches Strands' native OTel spans with OpenLIT-specific attributes,
 * extracts content from span events into span attributes, emits
 * gen_ai.client.inference.operation.details log events for chat spans,
 * and records OpenLIT metrics.
 *
 * Provider-level chat spans (OpenAI, Anthropic, etc.) are suppressed
 * when they occur inside a Strands chat span via the shared
 * frameworkLlmActive flag.
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/strands/processor.py
 */

import { Context, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import type { SpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { Span } from '@opentelemetry/api';

import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  applyCustomSpanAttributes,
  setFrameworkLlmActive,
  resetFrameworkLlmActive,
} from '../../helpers';
import {
  extractContentFromEvents,
  inferProviderName,
  inferServerAddress,
  truncateContent,
  truncateMessageContent,
  recordStrandsMetrics,
  emitStrandsInferenceEvent,
} from './utils';

const STRANDS_TRACER_SCOPE = 'strands.telemetry.tracer';

/**
 * Enriches Strands-generated spans with OpenLIT telemetry.
 * Added to the TracerProvider so it receives all spans; non-Strands
 * spans are ignored via the _isStrandsSpan() check.
 */
export class StrandsSpanProcessor implements SpanProcessor {
  private _strandsVersion: string;
  private _chatSpanIds = new Set<string>();
  private _chatInfo = new Map<string, Record<string, any>>();

  constructor(strandsVersion: string = 'unknown') {
    this._strandsVersion = strandsVersion;
  }

  // -----------------------------------------------------------------
  // Span detection
  // -----------------------------------------------------------------

  private static _isStrandsSpan(span: any): boolean {
    const scope = span.instrumentationLibrary;
    if (scope && scope.name === STRANDS_TRACER_SCOPE) {
      return true;
    }
    const attrs = span.attributes || {};
    return (
      attrs['gen_ai.system'] === SemanticConvention.GEN_AI_SYSTEM_STRANDS ||
      attrs['gen_ai.provider.name'] === SemanticConvention.GEN_AI_SYSTEM_STRANDS
    );
  }

  // -----------------------------------------------------------------
  // Attribute mutation helpers (span is read-only after onEnd)
  // -----------------------------------------------------------------

  private static _setAttr(span: any, key: string, value: any): void {
    try {
      if (span.attributes) {
        span.attributes[key] = value;
      }
    } catch {
      // ignore
    }
  }

  private static _setAttrs(span: any, mapping: Record<string, any>): void {
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

  onStart(span: Span, _parentContext: Context): void {
    if (!StrandsSpanProcessor._isStrandsSpan(span as any)) return;

    try {
      span.setAttribute(ATTR_TELEMETRY_SDK_NAME, 'openlit');
      span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, this._strandsVersion);
      span.setAttribute(
        SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT,
        OpenlitConfig.environment || 'default',
      );
      span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName || 'default');
      applyCustomSpanAttributes(span);
    } catch {
      // ignore
    }

    const spanName = (span as any).name || '';
    if (spanName === 'chat') {
      try {
        (span as any)._kind = SpanKind.CLIENT;
      } catch {
        // ignore
      }
      try {
        setFrameworkLlmActive();
        const spanId = span.spanContext().spanId;
        this._chatSpanIds.add(spanId);
      } catch {
        // ignore
      }
    }
  }

  onEnd(span: ReadableSpan): void {
    if (!StrandsSpanProcessor._isStrandsSpan(span)) return;

    const spanId = span.spanContext().spanId;
    if (this._chatSpanIds.has(spanId)) {
      this._chatSpanIds.delete(spanId);
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

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  // -----------------------------------------------------------------
  // Core processing (mirrors Python _process_span)
  // -----------------------------------------------------------------

  private _processSpan(span: ReadableSpan): void {
    const attrs = span.attributes || {};
    let operation = String(attrs[SemanticConvention.GEN_AI_OPERATION] || '');

    // Normalize agent id: agent_name-span_id_hex
    const agentName = attrs[SemanticConvention.GEN_AI_AGENT_NAME] as string | undefined;
    if (agentName && !attrs[SemanticConvention.GEN_AI_AGENT_ID]) {
      const spanIdHex = span.spanContext().spanId;
      StrandsSpanProcessor._setAttr(
        span,
        SemanticConvention.GEN_AI_AGENT_ID,
        `${agentName}-${spanIdHex}`,
      );
    }

    // Normalize gen_ai.system → gen_ai.provider.name
    const genAiSystem = String(attrs['gen_ai.system'] || '');
    if (genAiSystem && !attrs[SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]) {
      const provider =
        genAiSystem === 'strands-agents' || genAiSystem === 'strands_agents'
          ? SemanticConvention.GEN_AI_SYSTEM_STRANDS
          : genAiSystem;
      StrandsSpanProcessor._setAttr(span, SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, provider);
    }

    // Normalize Strands-native cache token keys → OTel standard keys
    const cacheKeyMap: [string, string][] = [
      ['gen_ai.usage.cache_read_input_tokens', SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS],
      ['gen_ai.usage.cache_write_input_tokens', SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS],
    ];
    for (const [strandsKey, otelKey] of cacheKeyMap) {
      const val = attrs[strandsKey];
      if (val != null && !attrs[otelKey]) {
        StrandsSpanProcessor._setAttr(span, otelKey, val);
      }
    }

    // Remap Strands-native system_prompt → gen_ai.system_instructions
    if (operation === SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT) {
      const systemPrompt = attrs['system_prompt'] as string | undefined;
      if (systemPrompt && !attrs[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS]) {
        StrandsSpanProcessor._setAttr(span, SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS, systemPrompt);
      }
    }

    // Duration (HrTime → seconds)
    let duration = 0;
    if (span.endTime && span.startTime) {
      const endNs = span.endTime[0] * 1e9 + span.endTime[1];
      const startNs = span.startTime[0] * 1e9 + span.startTime[1];
      duration = (endNs - startNs) / 1e9;
    }
    StrandsSpanProcessor._setAttr(span, SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);

    // Server address / port (inferred from model name)
    const modelName = String(attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] || '');
    let serverAddress = String(attrs[SemanticConvention.SERVER_ADDRESS] || '');
    let serverPort = Number(attrs[SemanticConvention.SERVER_PORT] || 0);
    if (!serverAddress && modelName) {
      [serverAddress, serverPort] = inferServerAddress(modelName);
      if (serverAddress) {
        StrandsSpanProcessor._setAttrs(span, {
          [SemanticConvention.SERVER_ADDRESS]: serverAddress,
          [SemanticConvention.SERVER_PORT]: serverPort,
        });
      }
    }

    // Normalize multi-agent operation names to invoke_workflow
    if (operation === 'invoke_swarm' || operation === 'invoke_graph') {
      const workflowName = String(attrs[SemanticConvention.GEN_AI_AGENT_NAME] || '');
      StrandsSpanProcessor._setAttrs(span, {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
        [SemanticConvention.GEN_AI_WORKFLOW_NAME]: workflowName,
      });
      operation = SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK;
    }

    // Output type for agent / workflow spans
    if (
      operation === SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT ||
      operation === SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK
    ) {
      StrandsSpanProcessor._setAttr(span, SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
    }

    // Tool type and tool call id
    if (operation === SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS) {
      StrandsSpanProcessor._setAttr(span, SemanticConvention.GEN_AI_TOOL_TYPE, 'function');
      if (!attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID]) {
        const tid =
          attrs['tool_use_id'] ||
          attrs['toolUseId'] ||
          attrs['gen_ai.tool.call.id'] ||
          StrandsSpanProcessor._extractToolCallIdFromSpanEvents(span);
        if (tid) {
          StrandsSpanProcessor._setAttr(span, SemanticConvention.GEN_AI_TOOL_CALL_ID, String(tid));
        }
      }
    }

    // OTel-compliant span names
    this._setOtelCompliantSpanName(span, operation);

    // Chat span enrichment: match provider span attributes
    if (operation === SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT) {
      this._enrichChatSpan(span, attrs, modelName);
      this._storeChatInfoForParent(span, modelName);
    }

    // Propagate recommended attrs from child chat spans to invoke_agent
    if (operation === SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT) {
      this._enrichAgentFromChildren(span);
    }

    // Content capture: extract from events → span attributes
    if (OpenlitConfig.captureMessageContent) {
      this._extractAndSetContent(span, operation);
    }

    // Emit inference log event for chat spans
    if (operation === SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT) {
      this._emitChatInferenceEvent(span, attrs, serverAddress, serverPort);
    }

    // Record OpenLIT metrics
    if (!OpenlitConfig.disableMetrics && operation) {
      recordStrandsMetrics(operation, duration, modelName, serverAddress, serverPort);
    }

    // Set error type if missing (low-cardinality per OTel spec)
    if (span.status && span.status.code === SpanStatusCode.ERROR) {
      const currentAttrs = span.attributes || {};
      if (!currentAttrs[SemanticConvention.ERROR_TYPE]) {
        StrandsSpanProcessor._setAttr(
          span,
          SemanticConvention.ERROR_TYPE,
          '_OTHER',
        );
      }
    }
  }

  // -----------------------------------------------------------------
  // OTel-compliant span naming
  // -----------------------------------------------------------------

  private _setOtelCompliantSpanName(span: ReadableSpan, operation: string): void {
    if (
      operation !== SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT &&
      operation !== SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS &&
      operation !== SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK
    ) {
      return;
    }
    try {
      const attrs = span.attributes || {};
      if (operation === SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT) {
        const name = attrs[SemanticConvention.GEN_AI_AGENT_NAME];
        if (name) (span as any)._name = `invoke_agent ${name}`;
      } else if (operation === SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS) {
        const name = attrs[SemanticConvention.GEN_AI_TOOL_NAME];
        if (name) (span as any)._name = `execute_tool ${name}`;
      } else if (operation === SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK) {
        const name = attrs[SemanticConvention.GEN_AI_WORKFLOW_NAME];
        if (name) (span as any)._name = `invoke_workflow ${name}`;
      }
    } catch {
      // ignore
    }
  }

  // -----------------------------------------------------------------
  // Chat span enrichment (parity with provider spans)
  // -----------------------------------------------------------------

  private _enrichChatSpan(span: ReadableSpan, attrs: Record<string, any>, modelName: string): void {
    const enrichments: Record<string, any> = {};

    // Span name: "chat" → "chat {model}"
    if (modelName) {
      try {
        (span as any)._name = `chat ${modelName}`;
      } catch {
        // ignore
      }
    }

    // Override gen_ai.provider.name with actual provider for chat spans
    const provider = modelName ? inferProviderName(modelName) : '';
    if (provider) {
      enrichments[SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL] = provider;
    }

    // response.model: fall back to request model
    if (!attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] && modelName) {
      enrichments[SemanticConvention.GEN_AI_RESPONSE_MODEL] = modelName;
    }

    // response.id: extract from events
    if (!attrs[SemanticConvention.GEN_AI_RESPONSE_ID]) {
      const responseId = StrandsSpanProcessor._extractResponseId(span);
      if (responseId) {
        enrichments[SemanticConvention.GEN_AI_RESPONSE_ID] = responseId;
      }
    }

    // Finish reasons from output events
    const [, outputMsgs] = extractContentFromEvents(span, 'chat');
    if (outputMsgs && outputMsgs.length > 0) {
      const finishReasons = outputMsgs
        .filter((m: any) => typeof m === 'object' && m.finish_reason)
        .map((m: any) => m.finish_reason);
      if (finishReasons.length > 0) {
        enrichments[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = finishReasons;
      }
    }

    enrichments[SemanticConvention.GEN_AI_OUTPUT_TYPE] = SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT;

    // Token totals and cost
    const inputTokens = Number(attrs['gen_ai.usage.input_tokens'] || 0);
    const outputTokens = Number(attrs['gen_ai.usage.output_tokens'] || 0);
    if (inputTokens || outputTokens) {
      enrichments[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] = inputTokens + outputTokens;
    }
    if (OpenlitConfig.pricingInfo && modelName) {
      const cost = OpenLitHelper.getChatModelCost(modelName, OpenlitConfig.pricingInfo, inputTokens, outputTokens);
      enrichments[SemanticConvention.GEN_AI_USAGE_COST] = cost;
    }

    if (Object.keys(enrichments).length > 0) {
      StrandsSpanProcessor._setAttrs(span, enrichments);
    }
  }

  private _storeChatInfoForParent(span: ReadableSpan, modelName: string): void {
    try {
      const parentId = (span as any).parentSpanId;
      if (!parentId) return;

      const finalAttrs = span.attributes || {};
      const info: Record<string, any> = {
        responseModel: finalAttrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] || modelName,
        responseId: finalAttrs[SemanticConvention.GEN_AI_RESPONSE_ID],
        finishReasons: finalAttrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON],
        inputTokens: finalAttrs['gen_ai.usage.input_tokens'] || 0,
        outputTokens: finalAttrs['gen_ai.usage.output_tokens'] || 0,
      };
      this._chatInfo.set(parentId, info);
    } catch {
      // ignore
    }
  }

  private _enrichAgentFromChildren(span: ReadableSpan): void {
    try {
      const spanId = span.spanContext().spanId;
      const info = this._chatInfo.get(spanId);
      this._chatInfo.delete(spanId);
      if (!info) return;

      const enrichments: Record<string, any> = {};
      const current = span.attributes || {};

      if (info.responseModel && !current[SemanticConvention.GEN_AI_RESPONSE_MODEL]) {
        enrichments[SemanticConvention.GEN_AI_RESPONSE_MODEL] = info.responseModel;
      }
      if (info.responseId && !current[SemanticConvention.GEN_AI_RESPONSE_ID]) {
        enrichments[SemanticConvention.GEN_AI_RESPONSE_ID] = info.responseId;
      }
      if (info.finishReasons && !current[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]) {
        enrichments[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = info.finishReasons;
      }
      if (Object.keys(enrichments).length > 0) {
        StrandsSpanProcessor._setAttrs(span, enrichments);
      }
    } catch {
      // ignore
    }
  }

  // -----------------------------------------------------------------
  // Static extraction helpers
  // -----------------------------------------------------------------

  private static _extractResponseId(span: ReadableSpan): string {
    for (const event of span.events || []) {
      const ea = event.attributes || {};
      const rid = ea['gen_ai.response.id'] || ea['response_id'];
      if (rid) return String(rid);
    }
    return '';
  }

  private static _extractToolCallIdFromSpanEvents(span: ReadableSpan): string | null {
    for (const event of span.events || []) {
      if (event.name === 'gen_ai.tool.message') {
        const ea = event.attributes || {};
        const tid = ea['id'] || ea[SemanticConvention.GEN_AI_TOOL_CALL_ID];
        if (tid) return String(tid);
      }
    }
    for (const event of span.events || []) {
      const ea = event.attributes || {};
      const tid =
        ea[SemanticConvention.GEN_AI_TOOL_CALL_ID] ||
        ea['tool_use_id'] ||
        ea['toolUseId'] ||
        ea['gen_ai.tool.call.id'];
      if (tid) return String(tid);
    }
    return null;
  }

  // -----------------------------------------------------------------
  // Content extraction → span attributes
  // -----------------------------------------------------------------

  private _extractAndSetContent(span: ReadableSpan, operation: string): void {
    try {
      const [inputMsgs, outputMsgs, systemInstr] = extractContentFromEvents(span, operation);
      const additions: Record<string, any> = {};

      if (operation === SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS) {
        if (inputMsgs.length > 0) {
          const first = inputMsgs[0];
          const parts = (typeof first === 'object' && first.parts) ? first.parts : [];
          if (parts.length > 0) {
            const arguments_ = parts[0].arguments || parts[0].response || '';
            additions[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS] = truncateContent(
              typeof arguments_ === 'string' ? arguments_ : JSON.stringify(arguments_),
            );
          }
        }
        if (outputMsgs.length > 0) {
          additions[SemanticConvention.GEN_AI_TOOL_CALL_RESULT] = truncateContent(
            JSON.stringify(outputMsgs),
          );
        }
      } else {
        if (inputMsgs.length > 0) {
          truncateMessageContent(inputMsgs);
          additions[SemanticConvention.GEN_AI_INPUT_MESSAGES] = JSON.stringify(inputMsgs);
        }
        if (outputMsgs.length > 0) {
          truncateMessageContent(outputMsgs);
          additions[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = JSON.stringify(outputMsgs);
        }
        if (systemInstr) {
          additions[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = truncateContent(String(systemInstr));
        }
      }

      if (Object.keys(additions).length > 0) {
        StrandsSpanProcessor._setAttrs(span, additions);
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
    attrs: Record<string, any>,
    serverAddress: string,
    serverPort: number,
  ): void {
    try {
      const [inputMsgs, outputMsgs, systemInstr] = extractContentFromEvents(span, 'chat');

      const extra: Record<string, any> = {};

      const inputTokens = attrs['gen_ai.usage.input_tokens'];
      const outputTokens = attrs['gen_ai.usage.output_tokens'];
      if (inputTokens != null) extra.inputTokens = inputTokens;
      if (outputTokens != null) extra.outputTokens = outputTokens;

      const cacheRead =
        attrs[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] ||
        attrs['gen_ai.usage.cache_read_input_tokens'];
      const cacheWrite =
        attrs[SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] ||
        attrs['gen_ai.usage.cache_write_input_tokens'];
      if (cacheRead != null) extra.cacheReadInputTokens = cacheRead;
      if (cacheWrite != null) extra.cacheCreationInputTokens = cacheWrite;

      const responseId =
        attrs[SemanticConvention.GEN_AI_RESPONSE_ID] ||
        StrandsSpanProcessor._extractResponseId(span);
      if (responseId) extra.responseId = responseId;

      if (systemInstr) extra.systemInstructions = systemInstr;

      if (outputMsgs.length > 0) {
        const finishReasons = outputMsgs
          .filter((m: any) => typeof m === 'object' && m.finish_reason)
          .map((m: any) => m.finish_reason);
        if (finishReasons.length > 0) extra.finishReasons = finishReasons;
      }

      extra.inputMessages = inputMsgs;
      extra.outputMessages = outputMsgs;

      emitStrandsInferenceEvent(
        span,
        String(attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] || ''),
        serverAddress,
        serverPort,
        extra,
      );
    } catch {
      // ignore
    }
  }
}
