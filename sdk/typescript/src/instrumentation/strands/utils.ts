/**
 * Strands Agents instrumentation utilities.
 *
 * Provides model-to-provider mapping, server address inference, content
 * extraction from Strands native span events, inference event emission,
 * and metrics recording.
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/strands/utils.py
 */

import { Attributes } from '@opentelemetry/api';
import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import OpenLitHelper, { getServerAddressForProvider } from '../../helpers';
import Metrics from '../../otel/metrics';

// -------------------------------------------------------------------------
// Model prefix → provider mapping (mirrors Python _MODEL_PREFIX_TO_PROVIDER)
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
// Content extraction from Strands span events
// -------------------------------------------------------------------------

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
 * Convert Strands Bedrock-style content blocks to OTel message parts.
 */
function convertStrandsContentToParts(content: any): any[] {
  let blocks = safeJsonParse(content);
  if (!Array.isArray(blocks)) {
    blocks = blocks ? [blocks] : [];
  }

  const parts: any[] = [];
  for (const block of blocks) {
    if (typeof block === 'object' && block !== null) {
      if ('text' in block) {
        parts.push({ type: 'text', content: block.text });
      } else if ('toolUse' in block) {
        const tu = block.toolUse;
        parts.push({
          type: 'tool_call',
          id: tu.toolUseId || '',
          name: tu.name || '',
          arguments: tu.input || {},
        });
      } else if ('toolResult' in block) {
        const tr = block.toolResult;
        parts.push({
          type: 'tool_call_response',
          id: tr.toolUseId || '',
          response: tr.content || '',
        });
      } else {
        for (const [key, value] of Object.entries(block)) {
          parts.push({ type: key, content: value });
        }
      }
    } else if (typeof block === 'string') {
      parts.push({ type: 'text', content: block });
    }
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: String(content) }];
}

/**
 * Extract message content from Strands span events.
 *
 * Handles both legacy named events (gen_ai.user.message, gen_ai.choice, etc.)
 * and the gen_ai.client.inference.operation.details event convention.
 *
 * Returns [inputMessages, outputMessages, systemInstructions].
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

    if (event.name === SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS) {
      if (ea[SemanticConvention.GEN_AI_INPUT_MESSAGES]) {
        const raw = safeJsonParse(ea[SemanticConvention.GEN_AI_INPUT_MESSAGES]);
        if (Array.isArray(raw)) inputMsgs.push(...raw);
        else if (raw) inputMsgs.push(raw);
      }
      if (ea[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]) {
        const raw = safeJsonParse(ea[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]);
        if (Array.isArray(raw)) outputMsgs.push(...raw);
        else if (raw) outputMsgs.push(raw);
      }
      if (ea[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS]) {
        systemInstructions = String(ea[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS]);
      }
      continue;
    }

    if (event.name === 'gen_ai.system.message') {
      systemInstructions = String(ea.content || '');
    } else if (event.name === 'gen_ai.user.message') {
      const content = ea.content || '';
      const parts = convertStrandsContentToParts(content);
      inputMsgs.push({ role: 'user', parts });
    } else if (event.name === 'gen_ai.assistant.message') {
      const content = ea.content || '';
      const parts = convertStrandsContentToParts(content);
      inputMsgs.push({ role: 'assistant', parts });
    } else if (event.name === 'gen_ai.tool.message') {
      const content = ea.content || '';
      const toolId = ea.id || '';
      if (operation === 'execute_tool') {
        inputMsgs.push({
          role: 'tool',
          parts: [{
            type: 'tool_call',
            id: toolId,
            name: '',
            arguments: safeJsonParse(content),
          }],
        });
      } else {
        inputMsgs.push({
          role: 'tool',
          parts: [{
            type: 'tool_call_response',
            id: toolId,
            response: safeJsonParse(content),
          }],
        });
      }
    } else if (event.name === 'gen_ai.choice') {
      const message = ea.message || '';
      const finishReason = ea.finish_reason || '';
      if (operation === 'execute_tool') {
        outputMsgs.push({
          role: 'tool',
          parts: convertStrandsContentToParts(message),
        });
      } else {
        const parts = convertStrandsContentToParts(message);
        const entry: any = { role: 'assistant', parts };
        if (finishReason) entry.finish_reason = String(finishReason);
        outputMsgs.push(entry);
      }
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

export function truncateMessageContent(messages: any[]): void {
  for (const msg of messages) {
    if (msg.parts && Array.isArray(msg.parts)) {
      for (const part of msg.parts) {
        if (part.content && typeof part.content === 'string') {
          part.content = truncateContent(part.content);
        }
        if (part.response && typeof part.response === 'string') {
          part.response = truncateContent(part.response);
        }
        if (part.arguments && typeof part.arguments === 'string') {
          part.arguments = truncateContent(part.arguments);
        }
      }
    }
  }
}

// -------------------------------------------------------------------------
// Metrics recording (mirrors Python record_strands_metrics)
// -------------------------------------------------------------------------

export function recordStrandsMetrics(
  operation: string,
  duration: number,
  modelName: string,
  serverAddress: string,
  serverPort: number
): void {
  try {
    const attributes: Attributes = {
      [SemanticConvention.GEN_AI_OPERATION]: operation,
      [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_STRANDS,
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
// Inference event emission (mirrors Python emit_strands_inference_event)
// -------------------------------------------------------------------------

export function emitStrandsInferenceEvent(
  span: any,
  requestModel: string,
  serverAddress: string,
  serverPort: number,
  extra: Record<string, any> = {}
): void {
  try {
    if (OpenlitConfig.disableEvents) return;

    const eventAttrs: Attributes = {
      [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
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
    if (extra.cacheReadInputTokens != null) {
      eventAttrs[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] = extra.cacheReadInputTokens;
    }
    if (extra.cacheCreationInputTokens != null) {
      eventAttrs[SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] = extra.cacheCreationInputTokens;
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
        eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = JSON.stringify(extra.inputMessages);
      }
      if (extra.outputMessages) {
        eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = JSON.stringify(extra.outputMessages);
      }
    }

    OpenLitHelper.emitInferenceEvent(span, eventAttrs);
  } catch {
    // ignore
  }
}
