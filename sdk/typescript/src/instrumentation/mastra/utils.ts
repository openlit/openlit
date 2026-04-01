/**
 * Mastra instrumentation utilities.
 *
 * Provides span name mapping, model-to-provider inference, content
 * extraction from Mastra span attributes/events, inference event
 * emission, and metrics recording.
 *
 * Mirrors the Python Strands utility pattern:
 *   sdk/python/src/openlit/instrumentation/strands/utils.py
 */

import { Attributes } from '@opentelemetry/api';
import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import OpenLitHelper, { getServerAddressForProvider } from '../../helpers';
import Metrics from '../../otel/metrics';

// -------------------------------------------------------------------------
// Mastra span name constants
// -------------------------------------------------------------------------

export const MastraSpanNames = {
  AGENT_GENERATE: 'agent.generate',
  AGENT_STREAM: 'agent.stream',
  AGENT_GET_RECENT_MESSAGE: 'agent.getMostRecentUserMessage',
  MASTRA_GET_AGENT: 'mastra.getAgent',
} as const;

// Mastra-specific span attribute keys (set by @mastra/otel-bridge)
export const MastraSpanAttrs = {
  AGENT_GENERATE_ARGUMENT: 'agent.generate.argument.0',
  AGENT_STREAM_ARGUMENT: 'agent.stream.argument.0',
  AGENT_GET_RECENT_MESSAGE_RESULT: 'agent.getMostRecentUserMessage.result',
  ENTITY_NAME: 'entityName',
  ENTITY_ID: 'entityId',
  THREAD_ID: 'threadId',
} as const;

// Spans that encompass LLM calls and should suppress provider spans
const LLM_ENCOMPASSING_SPANS: Set<string> = new Set([
  MastraSpanNames.AGENT_GENERATE,
  MastraSpanNames.AGENT_STREAM,
]);

// -------------------------------------------------------------------------
// Model prefix → provider mapping (same as Python Strands utils.py)
// -------------------------------------------------------------------------

const MODEL_PREFIX_TO_PROVIDER: [string, string][] = [
  ['anthropic.', 'aws.bedrock'],
  ['amazon.', 'aws.bedrock'],
  ['meta.', 'aws.bedrock'],
  ['us.anthropic.', 'aws.bedrock'],
  ['us.amazon.', 'aws.bedrock'],
  ['us.meta.', 'aws.bedrock'],
  ['eu.anthropic.', 'aws.bedrock'],
  ['eu.amazon.', 'aws.bedrock'],
  ['eu.meta.', 'aws.bedrock'],
  ['gpt-', 'openai'],
  ['o1', 'openai'],
  ['o3', 'openai'],
  ['o4', 'openai'],
  ['claude', 'anthropic'],
  ['gemini', 'google'],
  ['mistral', 'mistral_ai'],
  ['command', 'cohere'],
  ['deepseek', 'deepseek'],
];

// -------------------------------------------------------------------------
// Span detection and classification
// -------------------------------------------------------------------------

/**
 * Check if a span name indicates a Mastra span.
 */
export function isMastraSpanByName(spanName: string): boolean {
  return (
    spanName.startsWith('agent.') ||
    spanName.startsWith('workflow.') ||
    spanName.startsWith('mastra.') ||
    spanName.startsWith('tool.')
  );
}

/**
 * Map a Mastra span name to an OpenLIT/OTel operation type.
 * Returns null for internal spans that should be skipped.
 */
export function getOperationFromSpanName(spanName: string): string | null {
  if (
    spanName === MastraSpanNames.AGENT_GENERATE ||
    spanName === MastraSpanNames.AGENT_STREAM
  ) {
    return SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT;
  }

  if (spanName === MastraSpanNames.AGENT_GET_RECENT_MESSAGE) {
    return null;
  }

  if (spanName === MastraSpanNames.MASTRA_GET_AGENT) {
    return SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT;
  }

  if (spanName.startsWith('workflow.')) {
    return SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK;
  }

  if (spanName.startsWith('tool.')) {
    return SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS;
  }

  if (spanName.startsWith('mastra.')) {
    return null;
  }

  return null;
}

/**
 * Check if a span encompasses LLM calls and should trigger
 * framework LLM suppression.
 */
export function isLlmEncompassingSpan(spanName: string): boolean {
  return LLM_ENCOMPASSING_SPANS.has(spanName);
}

// -------------------------------------------------------------------------
// Model / provider inference
// -------------------------------------------------------------------------

export function inferServerAddress(modelName: string): [string, number] {
  if (!modelName) return ['', 0];
  const lower = modelName.toLowerCase();
  for (const [prefix, provider] of MODEL_PREFIX_TO_PROVIDER) {
    if (lower.startsWith(prefix)) {
      return getServerAddressForProvider(provider);
    }
  }
  return ['', 0];
}

export function inferProviderName(modelName: string): string {
  if (!modelName) return '';
  const lower = modelName.toLowerCase();
  for (const [prefix, provider] of MODEL_PREFIX_TO_PROVIDER) {
    if (lower.startsWith(prefix)) {
      return provider;
    }
  }
  return '';
}

// -------------------------------------------------------------------------
// Attribute extraction helpers
// -------------------------------------------------------------------------

export function extractAgentName(attrs: Record<string, any>): string {
  return String(
    attrs[SemanticConvention.GEN_AI_AGENT_NAME] ||
    attrs[MastraSpanAttrs.ENTITY_NAME] ||
    ''
  );
}

function safeJsonParse(value: any): any {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Extract message content from Mastra span attributes.
 */
export function extractContentFromAttributes(
  attrs: Record<string, any>,
  spanName: string
): [any[] | null, any[] | null, string | null] {
  let inputMessages: any[] | null = null;
  let outputMessages: any[] | null = null;
  let systemInstructions: string | null = null;

  if (attrs[SemanticConvention.GEN_AI_INPUT_MESSAGES]) {
    const raw = safeJsonParse(attrs[SemanticConvention.GEN_AI_INPUT_MESSAGES]);
    inputMessages = Array.isArray(raw) ? raw : raw ? [raw] : null;
  }

  if (attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]) {
    const raw = safeJsonParse(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]);
    outputMessages = Array.isArray(raw) ? raw : raw ? [raw] : null;
  }

  if (attrs[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS]) {
    systemInstructions = String(attrs[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS]);
  }

  // Mastra-specific attributes as fallback for input
  if (!inputMessages) {
    const argument =
      attrs[MastraSpanAttrs.AGENT_GENERATE_ARGUMENT] ||
      attrs[MastraSpanAttrs.AGENT_STREAM_ARGUMENT];
    if (argument) {
      const parsed = safeJsonParse(argument);
      if (Array.isArray(parsed)) {
        inputMessages = parsed.map((msg: any) => ({
          role: msg.role || 'user',
          parts: [
            {
              type: 'text',
              content:
                typeof msg.content === 'string'
                  ? msg.content
                  : JSON.stringify(msg.content),
            },
          ],
        }));
      } else if (typeof parsed === 'string') {
        inputMessages = [
          { role: 'user', parts: [{ type: 'text', content: parsed }] },
        ];
      }
    }
  }

  return [inputMessages, outputMessages, systemInstructions];
}

/**
 * Extract message content from span events (OTel event convention).
 * Handles both the gen_ai.client.inference.operation.details event
 * and legacy named events (gen_ai.user.message, gen_ai.choice, etc.).
 */
export function extractContentFromEvents(
  span: any,
  operation: string
): [any[], any[], string | null] {
  const inputMsgs: any[] = [];
  const outputMsgs: any[] = [];
  let systemInstructions: string | null = null;

  for (const event of span.events || []) {
    const ea = event.attributes || {};

    if (
      event.name ===
      SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS
    ) {
      if (ea[SemanticConvention.GEN_AI_INPUT_MESSAGES]) {
        const raw = safeJsonParse(ea[SemanticConvention.GEN_AI_INPUT_MESSAGES]);
        if (Array.isArray(raw)) inputMsgs.push(...raw);
        else if (raw) inputMsgs.push(raw);
      }
      if (ea[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]) {
        const raw = safeJsonParse(
          ea[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
        );
        if (Array.isArray(raw)) outputMsgs.push(...raw);
        else if (raw) outputMsgs.push(raw);
      }
      if (ea[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS]) {
        systemInstructions = String(
          ea[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS]
        );
      }
      continue;
    }

    if (event.name === 'gen_ai.system.message') {
      systemInstructions = String(ea.content || '');
    } else if (event.name === 'gen_ai.user.message') {
      inputMsgs.push({
        role: 'user',
        parts: [{ type: 'text', content: String(ea.content || '') }],
      });
    } else if (event.name === 'gen_ai.assistant.message') {
      inputMsgs.push({
        role: 'assistant',
        parts: [{ type: 'text', content: String(ea.content || '') }],
      });
    } else if (event.name === 'gen_ai.choice') {
      const msg = ea.message || '';
      const fr = ea.finish_reason || '';
      const entry: any = {
        role: 'assistant',
        parts: [
          {
            type: 'text',
            content: typeof msg === 'string' ? msg : JSON.stringify(msg),
          },
        ],
      };
      if (fr) entry.finish_reason = String(fr);
      outputMsgs.push(entry);
    }
  }

  return [inputMsgs, outputMsgs, systemInstructions];
}

// -------------------------------------------------------------------------
// Content truncation
// -------------------------------------------------------------------------

export function truncateContent(content: string): string {
  const maxLen = OpenlitConfig.maxContentLength;
  if (maxLen && content.length > maxLen) {
    return content.substring(0, maxLen) + '...';
  }
  return content;
}

// -------------------------------------------------------------------------
// Metrics recording (matching Python Strands record_strands_metrics)
// -------------------------------------------------------------------------

export function recordMastraMetrics(
  operation: string,
  duration: number,
  modelName: string,
  serverAddress: string,
  serverPort: number
): void {
  try {
    const attributes: Attributes = {
      [SemanticConvention.GEN_AI_OPERATION]: operation,
      [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]:
        SemanticConvention.GEN_AI_SYSTEM_MASTRA,
      'service.name': OpenlitConfig.applicationName || 'default',
      'deployment.environment': OpenlitConfig.environment || 'default',
    };
    if (modelName && modelName !== 'unknown') {
      attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = modelName;
    }
    if (serverAddress) {
      attributes[SemanticConvention.SERVER_ADDRESS] = serverAddress;
    }
    if (serverPort) {
      attributes[SemanticConvention.SERVER_PORT] = serverPort;
    }

    Metrics.genaiClientOperationDuration?.record(duration, attributes);
  } catch {
    // ignore
  }
}

// -------------------------------------------------------------------------
// Inference event emission (matching Python Strands emit_strands_inference_event)
// -------------------------------------------------------------------------

export function emitMastraInferenceEvent(
  span: any,
  requestModel: string,
  serverAddress: string,
  serverPort: number,
  extra: Record<string, any> = {}
): void {
  try {
    const eventAttrs: Attributes = {
      [SemanticConvention.GEN_AI_OPERATION]:
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    };

    if (requestModel) {
      eventAttrs[SemanticConvention.GEN_AI_REQUEST_MODEL] = requestModel;
    }
    if (serverAddress) {
      eventAttrs[SemanticConvention.SERVER_ADDRESS] = serverAddress;
    }
    if (serverPort) {
      eventAttrs[SemanticConvention.SERVER_PORT] = serverPort;
    }

    if (extra.inputTokens != null) {
      eventAttrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = extra.inputTokens;
    }
    if (extra.outputTokens != null) {
      eventAttrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = extra.outputTokens;
    }
    if (extra.responseId) {
      eventAttrs[SemanticConvention.GEN_AI_RESPONSE_ID] = extra.responseId;
    }
    if (extra.finishReasons) {
      eventAttrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = extra.finishReasons;
    }
    if (extra.systemInstructions) {
      eventAttrs[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = extra.systemInstructions;
    }

    if (OpenlitConfig.captureMessageContent) {
      if (extra.inputMessages) {
        eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = JSON.stringify(
          extra.inputMessages
        );
      }
      if (extra.outputMessages) {
        eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = JSON.stringify(
          extra.outputMessages
        );
      }
    }

    OpenLitHelper.emitInferenceEvent(span, eventAttrs);
  } catch {
    // ignore
  }
}
