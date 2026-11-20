import { Attributes, Span, SpanKind, context, trace as otelTrace } from '@opentelemetry/api';
import OpenlitConfig from './config';
import OpenLitHelper, { getCurrentAgentVersion } from './helpers';
import BaseWrapper, { BaseSpanAttributes } from './instrumentation/base-wrapper';
import { getTracer } from './manual-trace';
import SemanticConvention from './semantic-convention';

export type LlmCallOptions = {
  provider: string;
  model: string;
  /** `gen_ai.operation.name`. Defaults to `chat`. */
  operation?: string;
  serverAddress?: string;
  serverPort?: number;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Overrides the cost computed from pricing data. */
  cost?: number;
};

export type LlmResponse = {
  id?: string;
  /** The model that answered, when it differs from the requested one. */
  model?: string;
  finishReason?: string;
};

function toMessages(input: unknown): any[] {
  if (Array.isArray(input)) return input;
  const content = typeof input === 'string' ? input : JSON.stringify(input);
  return [{ role: 'user', content }];
}

function toText(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output);
}

type RecordedCall = {
  usage?: LlmUsage;
  response: LlmResponse;
  input?: unknown;
  system?: string;
  output?: unknown;
};

/** Handle passed to the `openlit.llm()` callback. Content setters honour `captureMessageContent`. */
export class LlmSpan {
  private call: RecordedCall = { response: {} };

  constructor(readonly span: Span) {}

  setInput(input: unknown, system?: string): void {
    this.call.input = input;
    this.call.system = system;
  }

  setOutput(output: unknown): void {
    this.call.output = output;
  }

  setUsage(usage: LlmUsage): void {
    this.call.usage = usage;
  }

  setResponse(response: LlmResponse): void {
    this.call.response = { ...this.call.response, ...response };
  }

  /** @internal */
  recorded(): RecordedCall {
    return this.call;
  }

  setAttributes(attributes: Attributes): void {
    this.span.setAttributes(attributes);
  }
}

/** Mirrors a patched provider's success path, except what only a raw response holds. */
function finishSpan(handle: LlmSpan, options: LlmCallOptions): BaseSpanAttributes {
  const { span } = handle;
  const { usage, response, input, system, output } = handle.recorded();
  const { provider, model, serverAddress, serverPort, temperature, topP, maxTokens } = options;
  const operation = options.operation ?? SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT;
  const capture = OpenlitConfig.captureMessageContent;
  const responseModel = response.model || model;
  const finishReason = response.finishReason || 'stop';
  const outputType = SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT;

  if (temperature != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
  if (topP != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, topP);
  if (maxTokens != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, maxTokens);
  span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
  if (response.id) span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.id);

  const cost =
    usage?.cost ??
    (usage
      ? OpenLitHelper.getChatModelCost(
          responseModel,
          OpenlitConfig.pricingInfo || {},
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens ?? 0,
          usage.cacheCreationTokens ?? 0
        )
      : undefined);

  const metricParams: BaseSpanAttributes = {
    genAIEndpoint: `${provider}.llm`,
    model,
    cost,
    aiSystem: provider,
    serverAddress,
    serverPort,
  };
  BaseWrapper.setBaseSpanAttributes(span, metricParams);

  span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
  if (usage) {
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, usage.inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, usage.outputTokens);
    if (usage.cacheCreationTokens) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, usage.cacheCreationTokens);
    }
    if (usage.cacheReadTokens) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, usage.cacheReadTokens);
    }
  }
  span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
  span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

  const versionExtras: Record<string, string> = {};
  try {
    const versionHash = OpenLitHelper.computeAgentVersionHash({
      systemInstructions: system ? JSON.stringify([{ type: 'text', content: system }]) : null,
      toolDefinitions: null,
      primaryModel: responseModel,
      runtimeConfig: {
        temperature: temperature ?? null,
        top_p: topP ?? null,
        max_tokens: maxTokens ?? null,
        provider,
      },
      providers: [provider],
    });
    if (versionHash) {
      versionExtras[SemanticConvention.OPENLIT_AGENT_VERSION_HASH] = versionHash;
      span.setAttribute(SemanticConvention.OPENLIT_AGENT_VERSION_HASH, versionHash);
    }
  } catch {
    // Never fail the wrapped call on hash issues.
  }
  const versionLabel = getCurrentAgentVersion();
  if (versionLabel) {
    versionExtras[SemanticConvention.GEN_AI_AGENT_VERSION] = versionLabel;
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_VERSION, versionLabel);
  }

  let inputMessages: string | undefined;
  let outputMessages: string | undefined;
  if (capture) {
    if (input !== undefined) {
      inputMessages = OpenLitHelper.buildInputMessages(toMessages(input), system);
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessages);
    }
    if (system) span.setAttribute(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS, system);
    if (output !== undefined) {
      outputMessages = OpenLitHelper.buildOutputMessages(toText(output), finishReason);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessages);
    }
  }

  if (!OpenlitConfig.disableEvents) {
    const eventAttributes: Attributes = {
      [SemanticConvention.GEN_AI_OPERATION]: operation,
      [SemanticConvention.GEN_AI_REQUEST_MODEL]: model,
      [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
      [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason],
      [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
      ...versionExtras,
    };
    if (serverAddress) eventAttributes[SemanticConvention.SERVER_ADDRESS] = serverAddress;
    if (serverPort !== undefined) eventAttributes[SemanticConvention.SERVER_PORT] = serverPort;
    if (response.id) eventAttributes[SemanticConvention.GEN_AI_RESPONSE_ID] = response.id;
    if (usage) {
      eventAttributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = usage.inputTokens;
      eventAttributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = usage.outputTokens;
    }
    if (inputMessages) eventAttributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessages;
    if (outputMessages) eventAttributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessages;
    OpenLitHelper.emitInferenceEvent(span, eventAttributes);
  }

  return metricParams;
}

/**
 * Trace a model call the SDK cannot patch, such as raw HTTP or a private model.
 * The span uses the same keys and pricing as a patched provider, so the UI shows
 * both the same way; only tool details are absent, as those come from a provider's
 * request. Telemetry problems never reach the caller; errors from `fn` are
 * recorded and rethrown.
 */
export async function llm<T>(options: LlmCallOptions, fn: (span: LlmSpan) => T | Promise<T>): Promise<T> {
  const operation = options.operation ?? SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT;
  const span: Span = getTracer().startSpan(`${operation} ${options.model}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      [SemanticConvention.GEN_AI_OPERATION]: operation,
      [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: options.provider,
      [SemanticConvention.GEN_AI_REQUEST_MODEL]: options.model,
      ...(options.serverAddress ? { [SemanticConvention.SERVER_ADDRESS]: options.serverAddress } : {}),
      ...(options.serverPort !== undefined ? { [SemanticConvention.SERVER_PORT]: options.serverPort } : {}),
    },
  });
  const handle = new LlmSpan(span);

  let result: T;
  try {
    result = await context.with(otelTrace.setSpan(context.active(), span), () => fn(handle));
  } catch (error: any) {
    OpenLitHelper.handleException(span, error);
    span.end();
    BaseWrapper.recordMetrics(span, {
      genAIEndpoint: `${options.provider}.llm`,
      model: options.model,
      aiSystem: options.provider,
      serverAddress: options.serverAddress,
      serverPort: options.serverPort,
      errorType: error?.constructor?.name || '_OTHER',
    });
    throw error;
  }

  let metricParams;
  try {
    metricParams = finishSpan(handle, options);
  } catch (error: any) {
    OpenLitHelper.handleException(span, error);
  }
  span.end();
  if (metricParams) BaseWrapper.recordMetrics(span, metricParams);
  return result;
}
